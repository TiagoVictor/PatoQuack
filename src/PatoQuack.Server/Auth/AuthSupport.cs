using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using PatoQuack.Server.Data;
using PatoQuack.Server.Email;

namespace PatoQuack.Server.Auth;

public static class AppClaims
{
    /// <summary>Nome exibido (vai no cookie, para o hub não consultar o banco a cada entrada).</summary>
    public const string DisplayName = "pq:name";
}

/// <summary>Põe o nome exibido nas claims da sessão.</summary>
public sealed class AppClaimsFactory(UserManager<AppUser> users, IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<AppUser>(users, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        identity.AddClaim(new Claim(AppClaims.DisplayName, user.DisplayName));
        return identity;
    }
}

/// <summary>Mensagens do Identity em português (só as que aparecem nos nossos fluxos).</summary>
public sealed class PtBrIdentityErrorDescriber : IdentityErrorDescriber
{
    public override IdentityError PasswordTooShort(int length) => new() { Code = nameof(PasswordTooShort), Description = $"A senha precisa ter pelo menos {length} caracteres." };
    public override IdentityError DuplicateEmail(string email) => new() { Code = nameof(DuplicateEmail), Description = "Já existe uma conta com esse e-mail." };
    public override IdentityError DuplicateUserName(string userName) => new() { Code = nameof(DuplicateUserName), Description = "Já existe uma conta com esse e-mail." };
    public override IdentityError InvalidEmail(string? email) => new() { Code = nameof(InvalidEmail), Description = "E-mail inválido." };
    public override IdentityError InvalidUserName(string? userName) => new() { Code = nameof(InvalidUserName), Description = "E-mail inválido." };
    public override IdentityError InvalidToken() => new() { Code = nameof(InvalidToken), Description = "Link inválido ou vencido. Peça um novo." };
    public override IdentityError PasswordRequiresUniqueChars(int uniqueChars) => new() { Code = nameof(PasswordRequiresUniqueChars), Description = $"A senha precisa ter pelo menos {uniqueChars} caracteres diferentes." };
}

/// <summary>Monta os links dos e-mails a partir do endereço público configurado.</summary>
public sealed class AppLinks(IOptions<AppOptions> app, IHostEnvironment env)
{
    /// <summary>
    /// Endereço base. Em desenvolvimento, sem App:PublicUrl, usa o da requisição; fora dele,
    /// exige a configuração (link montado pelo Host da requisição pode ser forjado).
    /// </summary>
    public string BaseUrl(HttpRequest request)
    {
        var configured = app.Value.PublicUrl.TrimEnd('/');
        if (!string.IsNullOrEmpty(configured))
        {
            return configured;
        }

        if (env.IsDevelopment())
        {
            return $"{request.Scheme}://{request.Host}";
        }

        throw new InvalidOperationException("Configure App:PublicUrl (endereço público) para enviar e-mails com links.");
    }

    public static string EncodeToken(string token) => WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(token));

    public static string? DecodeToken(string? encoded)
    {
        if (string.IsNullOrEmpty(encoded)) return null;
        try { return System.Text.Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encoded)); }
        catch (FormatException) { return null; }
    }

    /// <summary>Código aleatório de convite (128 bits, seguro para URL).</summary>
    public static string NewInviteCode() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16));
}
