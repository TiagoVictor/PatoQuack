using System.Security.Claims;
using PatoQuack.Domain.Users;

namespace PatoQuack.Server.Auth;

public static class ClaimsPrincipalExtensions
{
    /// <summary>Id do usuário logado. Só chame em endpoints/hubs que exigem autenticação.</summary>
    public static Guid GetUserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? id
            : throw new InvalidOperationException("Usuário não autenticado.");

    public static ClaimsPrincipal ToPrincipal(this User user, string authenticationScheme) =>
        new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
            ],
            authenticationScheme));
}
