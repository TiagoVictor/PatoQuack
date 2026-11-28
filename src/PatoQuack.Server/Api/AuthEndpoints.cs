using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http.HttpResults;
using PatoQuack.Application.Users;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Users;
using PatoQuack.Server.Auth;

namespace PatoQuack.Server.Api;

/// <summary>
/// Cadastro, login e sessão. A sessão é um cookie HttpOnly (o SignalR usa o mesmo cookie);
/// a aplicação só confere credenciais, quem cria o cookie é este adaptador.
/// </summary>
public static class AuthEndpoints
{
    private const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth")
            .AddEndpointFilter(ApiSecurity.RequireCsrfHeader)
            .RequireRateLimiting(ApiSecurity.AuthRateLimitPolicy);

        group.MapPost("/register", RegisterAsync);
        group.MapPost("/login", LoginAsync);
        group.MapPost("/logout", LogoutAsync);
        group.MapGet("/me", MeAsync).RequireAuthorization();

        return app;
    }

    private static async Task<Results<Created<UserDto>, ProblemHttpResult>> RegisterAsync(
        RegisterRequest request, IAuthService auth, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await auth.RegisterAsync(
            new RegisterCommand(request.Name, request.Email, request.Username, request.Password), cancellationToken);

        if (result.Status != RegisterStatus.Registered)
        {
            return result.Status switch
            {
                RegisterStatus.EmailTaken => Conflict("Já existe uma conta com esse e-mail."),
                RegisterStatus.UsernameTaken => Conflict("Esse nome de usuário já está em uso."),
                RegisterStatus.InvalidName => BadRequest($"Nome inválido. Use de 1 a {DisplayName.MaxLength} caracteres."),
                RegisterStatus.InvalidEmail => BadRequest("E-mail inválido."),
                RegisterStatus.InvalidUsername => BadRequest(
                    $"Usuário inválido. Use de {Username.MinLength} a {Username.MaxLength} caracteres: letras minúsculas, números, \"_\" ou \".\"."),
                _ => BadRequest($"A senha precisa ter de {AuthService.MinPasswordLength} a {AuthService.MaxPasswordLength} caracteres."),
            };
        }

        var user = result.User!;
        await SignInAsync(http, user);
        return TypedResults.Created("/api/auth/me", ToDto(user));
    }

    private static async Task<Results<Ok<UserDto>, ProblemHttpResult>> LoginAsync(
        LoginRequest request, IAuthService auth, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await auth.LoginAsync(request.Login, request.Password, cancellationToken);
        switch (result.Status)
        {
            case LoginStatus.LockedOut:
                return TypedResults.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: "Login bloqueado",
                    detail: "Muitas senhas erradas seguidas. Espere alguns minutos e tente de novo.");
            case LoginStatus.Invalid:
                return TypedResults.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Login inválido",
                    detail: "E-mail/usuário ou senha incorretos.");
        }

        await SignInAsync(http, result.User!);
        return TypedResults.Ok(ToDto(result.User!));
    }

    private static async Task<NoContent> LogoutAsync(HttpContext http)
    {
        await http.SignOutAsync(Scheme);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<UserDto>, UnauthorizedHttpResult>> MeAsync(
        IAuthService auth, HttpContext http, CancellationToken cancellationToken)
    {
        // Confere no banco: o cookie pode ser de um usuário que não existe mais.
        var user = await auth.GetUserAsync(http.User.GetUserId(), cancellationToken);
        if (user is null)
        {
            await http.SignOutAsync(Scheme);
            return TypedResults.Unauthorized();
        }

        return TypedResults.Ok(ToDto(user));
    }

    private static Task SignInAsync(HttpContext http, User user) =>
        http.SignInAsync(Scheme, user.ToPrincipal(Scheme), new AuthenticationProperties { IsPersistent = true });

    private static UserDto ToDto(User user) => new(user.Id, user.Name, user.Email, user.Username);

    private static ProblemHttpResult BadRequest(string detail) =>
        TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Dados inválidos", detail: detail);

    private static ProblemHttpResult Conflict(string detail) =>
        TypedResults.Problem(statusCode: StatusCodes.Status409Conflict, title: "Já existe", detail: detail);
}
