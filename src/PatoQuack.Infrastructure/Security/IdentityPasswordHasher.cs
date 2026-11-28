using Microsoft.AspNetCore.Identity;
using PatoQuack.Application.Users;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Security;

/// <summary>
/// Adaptador para o hasher do ASP.NET Core Identity (PBKDF2 com salt, formato versionado). Só a
/// classe de hash é usada; o resto do Identity (UserManager, tabelas) não.
/// </summary>
internal sealed class IdentityPasswordHasher : IPasswordHasher
{
    private readonly PasswordHasher<User> _hasher = new();

    public string Hash(string password) => _hasher.HashPassword(null!, password);

    public PasswordVerification Verify(string hash, string password) =>
        _hasher.VerifyHashedPassword(null!, hash, password) switch
        {
            PasswordVerificationResult.Success => PasswordVerification.Success,
            PasswordVerificationResult.SuccessRehashNeeded => PasswordVerification.SuccessRehashNeeded,
            _ => PasswordVerification.Failed,
        };
}
