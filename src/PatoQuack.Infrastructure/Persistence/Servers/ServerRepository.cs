using Microsoft.EntityFrameworkCore;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Infrastructure.Persistence.Servers;

internal sealed class ServerRepository(PatoQuackDbContext db) : IServerRepository
{
    public Task<Server?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Servers.SingleOrDefaultAsync(s => s.Id == id, cancellationToken);

    public async Task<IReadOnlyList<Server>> ListByMemberAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await db.ServerMembers
            .AsNoTracking()
            .Where(m => m.UserId == userId)
            .OrderBy(m => m.JoinedAt)
            .Join(db.Servers, m => m.ServerId, s => s.Id, (_, s) => s)
            .ToListAsync(cancellationToken);

    public Task<bool> IsMemberAsync(Guid serverId, Guid userId, CancellationToken cancellationToken = default) =>
        db.ServerMembers.AnyAsync(m => m.ServerId == serverId && m.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<ServerMemberView>> ListMembersAsync(Guid serverId, CancellationToken cancellationToken = default)
    {
        var ownerId = await db.Servers.Where(s => s.Id == serverId).Select(s => s.OwnerId).SingleOrDefaultAsync(cancellationToken);
        var rows = await db.ServerMembers
            .AsNoTracking()
            .Where(m => m.ServerId == serverId)
            .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { m.UserId, u.Name, u.Username, m.JoinedAt })
            .ToListAsync(cancellationToken);

        return rows
            .Select(x => new ServerMemberView(x.UserId, x.Name, x.Username, x.UserId == ownerId, x.JoinedAt))
            .OrderByDescending(m => m.IsOwner)
            .ThenBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<bool> RemoveMemberAsync(Guid serverId, Guid userId, CancellationToken cancellationToken = default) =>
        await db.ServerMembers.Where(m => m.ServerId == serverId && m.UserId == userId).ExecuteDeleteAsync(cancellationToken) > 0;

    public async Task AddAsync(Server server, CancellationToken cancellationToken = default) =>
        await db.Servers.AddAsync(server, cancellationToken);

    public async Task AddMemberAsync(ServerMember member, CancellationToken cancellationToken = default) =>
        await db.ServerMembers.AddAsync(member, cancellationToken);

    public void Remove(Server server) => db.Servers.Remove(server);
}
