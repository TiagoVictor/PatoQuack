using Microsoft.EntityFrameworkCore.Storage;
using PatoQuack.Domain.Abstractions;

namespace PatoQuack.Infrastructure.Persistence;

internal sealed class UnitOfWork(PatoQuackDbContext db) : IUnitOfWork
{
    public async Task<ITransaction> BeginTransactionAsync(CancellationToken cancellationToken = default) =>
        new EfTransaction(await db.Database.BeginTransactionAsync(cancellationToken));

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) =>
        db.SaveChangesAsync(cancellationToken);

    private sealed class EfTransaction(IDbContextTransaction transaction) : ITransaction
    {
        public Task CommitAsync(CancellationToken cancellationToken = default) =>
            transaction.CommitAsync(cancellationToken);

        public ValueTask DisposeAsync() => transaction.DisposeAsync();
    }
}
