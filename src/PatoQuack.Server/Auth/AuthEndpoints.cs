using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PatoQuack.Server.Data;
using PatoQuack.Server.Email;
using PatoQuack.Server.Voice;

namespace PatoQuack.Server.Auth;

public sealed record SetupRequest(string? Email, string? DisplayName, string? Password);
public sealed record RegisterRequest(string? Invite, string? Email, string? DisplayName, string? Password);
public sealed record LoginRequest(string? Email, string? Password);
public sealed record EmailRequest(string? Email);
public sealed record ConfirmRequest(string? UserId, string? Token);
public sealed record ResetRequest(string? UserId, string? Token, string? Password);
public sealed record CreateInviteRequest(string? Room);

public sealed record UserDto(string Id, string Email, string DisplayName, bool IsAdmin);
public sealed record AuthStateDto(bool SetupRequired, UserDto? User);
public sealed record InviteDto(string Code, string Url, DateTimeOffset ExpiresAt, string? Room);
public sealed record InviteInfoDto(bool Valid, string? InviterName, string? Room);
public sealed record ErrorDto(string Error);

/// <summary>
/// API de contas (/api/auth) e convites (/api/invites). JSON, cookie de sessão do Identity.
///
/// Proteção contra requisição forjada (CSRF): o cookie é SameSite=Lax e toda chamada que muda
/// estado exige o cabeçalho X-PatoQuack (um formulário de outro site não consegue enviá-lo sem
/// passar pelo CORS, que não liberamos). Erros de login são genéricos para não revelar se o
/// e-mail existe; "esqueci a senha" responde igual exista ou não a conta.
/// </summary>
public static class AuthEndpoints
{
    public const string CsrfHeader = "X-PatoQuack";
    public const string RateLimitPolicy = "auth";
    private static readonly TimeSpan InviteLifetime = TimeSpan.FromDays(7);
    private static readonly SemaphoreSlim SetupLock = new(1, 1);

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api").AddEndpointFilter(RequireCsrfHeader);

        api.MapGet("/auth/state", GetState);

        var auth = api.MapGroup("/auth").RequireRateLimiting(RateLimitPolicy);
        auth.MapPost("/setup", Setup);
        auth.MapPost("/register", Register);
        auth.MapPost("/login", Login);
        auth.MapPost("/logout", Logout);
        auth.MapPost("/confirm", Confirm);
        auth.MapPost("/resend-confirmation", ResendConfirmation);
        auth.MapPost("/forgot", Forgot);
        auth.MapPost("/reset", Reset);

        api.MapPost("/invites", CreateInvite).RequireAuthorization();
        api.MapGet("/invites/{code}", GetInvite).RequireRateLimiting(RateLimitPolicy);
    }

    private static async ValueTask<object?> RequireCsrfHeader(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.HttpContext.Request;
        if (!HttpMethods.IsGet(request.Method) && request.Headers[CsrfHeader] != "1")
        {
            return Results.Json(new ErrorDto("Requisição recusada."), statusCode: StatusCodes.Status400BadRequest);
        }

        return await next(context);
    }

    private static IResult Error(string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new ErrorDto(message), statusCode: status);

    private static IResult IdentityError(IdentityResult result) =>
        Error(result.Errors.FirstOrDefault()?.Description ?? "Não foi possível concluir.");

    private static UserDto ToDto(AppUser u) => new(u.Id, u.Email ?? string.Empty, u.DisplayName, u.IsAdmin);

    // ---- estado ----------------------------------------------------------------

    private static async Task<IResult> GetState(ClaimsPrincipal principal, UserManager<AppUser> users)
    {
        var setupRequired = !await users.Users.AnyAsync();
        var user = principal.Identity?.IsAuthenticated == true ? await users.GetUserAsync(principal) : null;
        return Results.Ok(new AuthStateDto(setupRequired, user is null ? null : ToDto(user)));
    }

    // ---- primeiro acesso: cria o administrador -----------------------------------

    private static async Task<IResult> Setup(SetupRequest body, UserManager<AppUser> users, SignInManager<AppUser> signIn, TimeProvider time)
    {
        if (!TryReadAccount(body.Email, body.DisplayName, body.Password, out var email, out var name, out var problem))
        {
            return Error(problem);
        }

        // Duas pessoas no primeiro acesso ao mesmo tempo: só a primeira vira administradora.
        await SetupLock.WaitAsync();
        try
        {
            if (await users.Users.AnyAsync())
            {
                return Error("O PatoQuack já foi configurado. Entre com sua conta.", StatusCodes.Status409Conflict);
            }

            // O e-mail do administrador não é confirmado por link: o envio de e-mail pode ainda
            // não estar configurado no primeiro acesso.
            var admin = new AppUser { UserName = email, Email = email, DisplayName = name, IsAdmin = true, EmailConfirmed = true, CreatedAt = time.GetUtcNow() };
            var created = await users.CreateAsync(admin, body.Password!);
            if (!created.Succeeded)
            {
                return IdentityError(created);
            }

            await signIn.SignInAsync(admin, isPersistent: true);
            return Results.Ok(ToDto(admin));
        }
        finally
        {
            SetupLock.Release();
        }
    }

    // ---- cadastro por convite -----------------------------------------------------

    private static async Task<IResult> Register(
        RegisterRequest body, HttpRequest request, AppDbContext db, UserManager<AppUser> users,
        IAppEmailSender mail, AppLinks links, TimeProvider time)
    {
        if (!TryReadAccount(body.Email, body.DisplayName, body.Password, out var email, out var name, out var problem))
        {
            return Error(problem);
        }

        var now = time.GetUtcNow();
        var invite = await db.SignupInvites.AsNoTracking().FirstOrDefaultAsync(i => i.Code == body.Invite);
        if (invite is null || invite.UsedAt is not null || invite.ExpiresAt <= now)
        {
            return Error("Convite inválido, vencido ou já usado. Peça um novo a quem te convidou.");
        }

        if (await users.FindByEmailAsync(email) is not null)
        {
            return Error("Já existe uma conta com esse e-mail. Entre com ela.");
        }

        var user = new AppUser { UserName = email, Email = email, DisplayName = name, CreatedAt = now };

        // Reserva o convite antes de criar a conta: a atualização só vale se ninguém usou ainda,
        // então dois cadastros simultâneos com o mesmo convite não passam os dois.
        var reserved = await db.SignupInvites
            .Where(i => i.Id == invite.Id && i.UsedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.UsedAt, now).SetProperty(i => i.UsedById, user.Id));
        if (reserved == 0)
        {
            return Error("Convite inválido, vencido ou já usado. Peça um novo a quem te convidou.");
        }

        var created = await users.CreateAsync(user, body.Password!);
        if (!created.Succeeded)
        {
            // Libera o convite: a conta não foi criada (ex.: senha fraca).
            await db.SignupInvites.Where(i => i.Id == invite.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(i => i.UsedAt, (DateTimeOffset?)null).SetProperty(i => i.UsedById, (string?)null));
            return IdentityError(created);
        }

        await SendConfirmationAsync(user, request, users, mail, links, invite.Room);
        return Results.Ok(new { needsConfirmation = true });
    }

    private static async Task SendConfirmationAsync(AppUser user, HttpRequest request, UserManager<AppUser> users, IAppEmailSender mail, AppLinks links, string? room)
    {
        var token = AppLinks.EncodeToken(await users.GenerateEmailConfirmationTokenAsync(user));
        var link = $"{links.BaseUrl(request)}/auth.html?modo=confirmar&uid={Uri.EscapeDataString(user.Id)}&token={token}"
                   + (room is null ? string.Empty : $"&sala={Uri.EscapeDataString(room)}");
        await mail.SendAsync(new AppEmail(
            user.Email!,
            "Confirme sua conta no PatoQuack",
            $"Olá, {user.DisplayName}!\n\nPara ativar sua conta no PatoQuack, abra o link abaixo:\n\n{link}\n\nSe não foi você, ignore este e-mail.",
            link));
    }

    private static async Task<IResult> Confirm(ConfirmRequest body, UserManager<AppUser> users)
    {
        var token = AppLinks.DecodeToken(body.Token);
        var user = body.UserId is null ? null : await users.FindByIdAsync(body.UserId);
        if (user is null || token is null)
        {
            return Error("Link inválido ou vencido. Peça um novo.");
        }

        if (user.EmailConfirmed)
        {
            return Results.Ok(new { confirmed = true });
        }

        var result = await users.ConfirmEmailAsync(user, token);
        return result.Succeeded ? Results.Ok(new { confirmed = true }) : IdentityError(result);
    }

    private static async Task<IResult> ResendConfirmation(EmailRequest body, HttpRequest request, AppDbContext db, UserManager<AppUser> users, IAppEmailSender mail, AppLinks links)
    {
        var user = string.IsNullOrWhiteSpace(body.Email) ? null : await users.FindByEmailAsync(body.Email.Trim());
        if (user is { EmailConfirmed: false })
        {
            // Mantém a sala do convite que a pessoa usou (o link reenviado leva ao mesmo lugar).
            var room = await db.SignupInvites.Where(i => i.UsedById == user.Id).Select(i => i.Room).FirstOrDefaultAsync();
            await SendConfirmationAsync(user, request, users, mail, links, room);
        }

        return Results.Ok(); // mesma resposta exista ou não a conta
    }

    // ---- entrar / sair -----------------------------------------------------------------

    private static async Task<IResult> Login(LoginRequest body, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        const string wrong = "E-mail ou senha incorretos.";
        var user = string.IsNullOrWhiteSpace(body.Email) ? null : await users.FindByEmailAsync(body.Email.Trim());
        if (user is null || string.IsNullOrEmpty(body.Password))
        {
            return Error(wrong, StatusCodes.Status401Unauthorized);
        }

        var result = await signIn.PasswordSignInAsync(user, body.Password, isPersistent: true, lockoutOnFailure: true);
        if (result.Succeeded)
        {
            return Results.Ok(ToDto(user));
        }

        if (result.IsLockedOut)
        {
            return Error("Muitas tentativas erradas. Tente de novo em 15 minutos ou redefina a senha.", StatusCodes.Status423Locked);
        }

        if (result.IsNotAllowed)
        {
            // Só chega aqui com a senha certa: dá para dizer que falta confirmar o e-mail.
            return Error("Confirme seu e-mail antes de entrar (veja sua caixa de entrada).", StatusCodes.Status403Forbidden);
        }

        return Error(wrong, StatusCodes.Status401Unauthorized);
    }

    private static async Task<IResult> Logout(SignInManager<AppUser> signIn)
    {
        await signIn.SignOutAsync();
        return Results.Ok();
    }

    // ---- esqueci a senha -------------------------------------------------------------------

    private static async Task<IResult> Forgot(EmailRequest body, HttpRequest request, UserManager<AppUser> users, IAppEmailSender mail, AppLinks links)
    {
        var user = string.IsNullOrWhiteSpace(body.Email) ? null : await users.FindByEmailAsync(body.Email.Trim());
        if (user is { EmailConfirmed: true })
        {
            var token = AppLinks.EncodeToken(await users.GeneratePasswordResetTokenAsync(user));
            var link = $"{links.BaseUrl(request)}/auth.html?modo=redefinir&uid={Uri.EscapeDataString(user.Id)}&token={token}";
            await mail.SendAsync(new AppEmail(
                user.Email!,
                "Redefinir sua senha do PatoQuack",
                $"Olá, {user.DisplayName}!\n\nPara criar uma senha nova, abra o link abaixo (vale por pouco tempo):\n\n{link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.",
                link));
        }

        return Results.Ok(); // mesma resposta exista ou não a conta
    }

    private static async Task<IResult> Reset(ResetRequest body, UserManager<AppUser> users)
    {
        var token = AppLinks.DecodeToken(body.Token);
        var user = body.UserId is null ? null : await users.FindByIdAsync(body.UserId);
        if (user is null || token is null || string.IsNullOrEmpty(body.Password))
        {
            return Error("Link inválido ou vencido. Peça um novo.");
        }

        var result = await users.ResetPasswordAsync(user, token, body.Password);
        if (!result.Succeeded)
        {
            return IdentityError(result);
        }

        // Senha nova destrava a conta (quem foi bloqueado por tentativas erradas).
        await users.SetLockoutEndDateAsync(user, null);
        await users.ResetAccessFailedCountAsync(user);
        return Results.Ok();
    }

    // ---- convites ---------------------------------------------------------------------------

    private static async Task<IResult> CreateInvite(
        CreateInviteRequest body, ClaimsPrincipal principal, HttpRequest request, AppDbContext db,
        UserManager<AppUser> users, AppLinks links, TimeProvider time)
    {
        var userId = users.GetUserId(principal)!;
        string? room = null;
        if (!string.IsNullOrWhiteSpace(body.Room))
        {
            try { room = VoiceInput.NormalizeRoom(body.Room); }
            catch (Microsoft.AspNetCore.SignalR.HubException ex) { return Error(ex.Message); }
        }

        var now = time.GetUtcNow();
        var invite = new SignupInvite { Code = AppLinks.NewInviteCode(), CreatedById = userId, Room = room, CreatedAt = now, ExpiresAt = now + InviteLifetime };
        db.SignupInvites.Add(invite);
        await db.SaveChangesAsync();

        var url = $"{links.BaseUrl(request)}/auth.html?modo=cadastro&convite={invite.Code}"
                  + (room is null ? string.Empty : $"&sala={Uri.EscapeDataString(room)}");
        return Results.Ok(new InviteDto(invite.Code, url, invite.ExpiresAt, room));
    }

    private static async Task<IResult> GetInvite(string code, AppDbContext db, TimeProvider time)
    {
        var now = time.GetUtcNow();
        var invite = await db.SignupInvites.AsNoTracking().Include(i => i.CreatedBy).FirstOrDefaultAsync(i => i.Code == code);
        var valid = invite is not null && invite.UsedAt is null && invite.ExpiresAt > now;
        return Results.Ok(valid
            ? new InviteInfoDto(true, invite!.CreatedBy?.DisplayName, invite.Room)
            : new InviteInfoDto(false, null, null));
    }

    // ---- validação comum ------------------------------------------------------------------------

    private static bool TryReadAccount(string? rawEmail, string? rawName, string? password, out string email, out string name, out string problem)
    {
        email = rawEmail?.Trim() ?? string.Empty;
        name = string.Empty;
        problem = string.Empty;

        if (email.Length is 0 or > 254 || !new EmailAddressAttribute().IsValid(email))
        {
            problem = "E-mail inválido.";
            return false;
        }

        try
        {
            name = VoiceInput.NormalizeName(rawName);
        }
        catch (Microsoft.AspNetCore.SignalR.HubException ex)
        {
            problem = ex.Message;
            return false;
        }

        if (string.IsNullOrEmpty(password))
        {
            problem = "Escolha uma senha.";
            return false;
        }

        return true;
    }
}
