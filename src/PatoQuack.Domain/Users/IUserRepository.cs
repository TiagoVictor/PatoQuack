namespace PatoQuack.Domain.Users;

/// <summary>Porta de persistência dos usuários.</summary>
public interface IUserRepository
{
    Task<User?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Busca pelo e-mail ou usuário já normalizados.</summary>
    Task<User?> GetByEmailAsync(string email, CancellationToken cancellationToken = default);

    Task<User?> GetByUsernameAsync(string username, CancellationToken cancellationToken = default);

    Task<bool> EmailExistsAsync(string email, CancellationToken cancellationToken = default);

    Task<bool> UsernameExistsAsync(string username, CancellationToken cancellationToken = default);

    /// <summary>Marca o usuário para inclusão (efetivada no SaveChanges).</summary>
    Task AddAsync(User user, CancellationToken cancellationToken = default);
}
