using Microsoft.EntityFrameworkCore;
using PatoQuack.Domain.Participants;

namespace PatoQuack.Infrastructure.Persistence.Participants;

internal sealed class ParticipantRepository(PatoQuackDbContext db) : IParticipantRepository
{
    public Task<Participant?> GetByConnectionIdAsync(string connectionId, CancellationToken cancellationToken = default) =>
        db.Participants.SingleOrDefaultAsync(p => p.ConnectionId == connectionId, cancellationToken);

    public async Task<IReadOnlyList<Participant>> ListByChannelAsync(Guid channelId, CancellationToken cancellationToken = default) =>
        await db.Participants
            .AsNoTracking()
            .Where(p => p.ChannelId == channelId)
            .OrderBy(p => p.JoinedAt)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> ListConnectionsInServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default) =>
        await db.Participants
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Join(db.VoiceChannels.Where(c => c.ServerId == serverId), p => p.ChannelId, c => c.Id, (p, _) => p.ConnectionId)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(Participant participant, CancellationToken cancellationToken = default) =>
        await db.Participants.AddAsync(participant, cancellationToken);

    public void Remove(Participant participant) => db.Participants.Remove(participant);

    public Task DeleteAllAsync(CancellationToken cancellationToken = default) =>
        db.Participants.ExecuteDeleteAsync(cancellationToken);
}
