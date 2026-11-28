using PatoQuack.Domain.Users;

namespace PatoQuack.Application.Users;

/// <summary>
/// Cadastro e verificação de credenciais. Não sabe de cookies nem tokens: o adaptador HTTP
/// cria a sessão a partir do usuário devolvido aqui.
/// </summary>
public interface IAuthService
{
    Task<RegisterResult> RegisterAsync(RegisterCommand command, CancellationToken cancellationToken = default);

    /// <summary>
    /// Confere e-mail ou usuário + senha. Erro não diz qual parte errou. Senhas erradas seguidas
    /// bloqueiam o login por um tempo (<see cref="AuthOptions"/>).
    /// </summary>
    Task<LoginResult> LoginAsync(string? login, string? password, CancellationToken cancellationToken = default);

    Task<User?> GetUserAsync(Guid userId, CancellationToken cancellationToken = default);
}
