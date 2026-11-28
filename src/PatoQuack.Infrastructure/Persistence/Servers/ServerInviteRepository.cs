using Microsoft.EntityFrameworkCore;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Infrastructure.Persistence.Servers;

internal sealed class ServerInviteRepository(PatoQuackDbContext db) : IServerInviteRepository
{
    public Task<ServerInvite?> GetByCodeAsync(string code, CancellationToken cancellationToken = default) =>
        db.ServerInvites.SingleOrDefaultAsync(i => i.Code == code, cancellationToken);

    public Task<bool> CodeExistsAsync(string code, CancellationToken cancellationToken = default) =>
        db.ServerInvites.AnyAsync(i => i.Code == code, cancellationToken);

    public async Task<IReadOnlyList<ServerInvite>> ListUsableAsync(Guid serverId, DateTimeOffset now, CancellationToken cancellationToken = default) =>
        await db.ServerInvites
            .AsNoTracking()
            .Where(i => i.ServerId == serverId && i.RevokedAt == null
                        && (i.ExpiresAt == null || i.ExpiresAt > now)
                        && (i.MaxUses == null || i.Uses < i.MaxUses))
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(ServerInvite invite, CancellationToken cancellationToken = default) =>
        await db.ServerInvites.AddAsync(invite, cancellationToken);

    // UPDATE ... WHERE com as mesmas condições de "usável": o banco garante que dois aceites
    // simultâneos não passam do limite.
    public async Task<bool> TryConsumeUseAsync(Guid inviteId, DateTimeOffset now, CancellationToken cancellationToken = default) =>
        await db.ServerInvites
            .Where(i => i.Id == inviteId && i.RevokedAt == null
                        && (i.ExpiresAt == null || i.ExpiresAt > now)
                        && (i.MaxUses == null || i.Uses < i.MaxUses))
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.Uses, i => i.Uses + 1), cancellationToken) == 1;
}
