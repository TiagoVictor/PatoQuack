namespace PatoQuack.Domain.Abstractions;

/// <summary>
/// Agrupa as mudanças dos repositórios e as grava de uma vez. A implementação depende do banco;
/// a aplicação só conhece esta porta.
/// </summary>
public interface IUnitOfWork
{
    Task<ITransaction> BeginTransactionAsync(CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}

/// <summary>Transação aberta. Descartar sem <see cref="CommitAsync"/> desfaz tudo.</summary>
public interface ITransaction : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken = default);
}
