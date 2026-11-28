using Microsoft.EntityFrameworkCore;
using PatoQuack.Domain.Channels;
using C = PatoQuack.Infrastructure.Persistence.Channels.VoiceChannelConfiguration;
using P = PatoQuack.Infrastructure.Persistence.Participants.ParticipantConfiguration;

namespace PatoQuack.Infrastructure.Persistence.Channels;

/// <summary>
/// Repositório de canais no PostgreSQL. O lock do canal é um <c>SELECT ... FOR UPDATE</c> na linha
/// dele, que dura até o fim da transação. Esse SQL específico do Postgres fica só aqui: a
/// aplicação conhece apenas a porta <see cref="IVoiceChannelRepository"/>.
/// </summary>
internal sealed class VoiceChannelRepository(PatoQuackDbContext db) : IVoiceChannelRepository
{
    private const string SelectForUpdateSql =
        $"SELECT * FROM {C.Table} WHERE {C.Columns.Id} = {{0}} FOR UPDATE";

    private const string SelectByParticipantForUpdateSql =
        $"SELECT c.* FROM {C.Table} c " +
        $"JOIN {P.Table} p ON p.{P.Columns.ChannelId} = c.{C.Columns.Id} " +
        $"WHERE p.{P.Columns.ConnectionId} = {{0}} FOR UPDATE OF c";

    public Task<VoiceChannel?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.VoiceChannels.SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

    public void Remove(VoiceChannel channel) => db.VoiceChannels.Remove(channel);

    public async Task<IReadOnlyList<VoiceChannel>> ListByServerAsync(Guid serverId, CancellationToken cancellationToken = default) =>
        await db.VoiceChannels
            .AsNoTracking()
            .Where(c => c.ServerId == serverId)
            .OrderBy(c => c.CreatedAt)
            .ThenBy(c => c.Id)
            .ToListAsync(cancellationToken);

    public Task<bool> NameExistsAsync(Guid serverId, string name, Guid? exceptChannelId = null, CancellationToken cancellationToken = default)
    {
        var lowered = name.ToLower();
        return db.VoiceChannels.AnyAsync(
            c => c.ServerId == serverId && c.Name.ToLower() == lowered && c.Id != exceptChannelId,
            cancellationToken);
    }

    public async Task AddAsync(VoiceChannel channel, CancellationToken cancellationToken = default) =>
        await db.VoiceChannels.AddAsync(channel, cancellationToken);

    public Task<VoiceChannel?> GetLockedAsync(Guid id, CancellationToken cancellationToken = default)
    {
        EnsureTransaction();
        return LockAsync(SelectForUpdateSql, id, cancellationToken);
    }

    public Task<VoiceChannel?> GetLockedByParticipantAsync(string connectionId, CancellationToken cancellationToken = default)
    {
        EnsureTransaction();
        return LockAsync(SelectByParticipantForUpdateSql, connectionId, cancellationToken);
    }

    public Task ClearAllStreamersAsync(CancellationToken cancellationToken = default) =>
        db.VoiceChannels
            .Where(c => c.StreamerConnectionId != null)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.StreamerConnectionId, (string?)null), cancellationToken);

    private async Task<VoiceChannel?> LockAsync(string sql, object parameter, CancellationToken cancellationToken)
    {
        // ToListAsync (e não SingleOrDefaultAsync) para o EF não embrulhar o FOR UPDATE numa subquery.
        var rows = await db.VoiceChannels.FromSqlRaw(sql, parameter).ToListAsync(cancellationToken);
        return rows.SingleOrDefault();
    }

    private void EnsureTransaction()
    {
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("Travar um canal exige uma transação aberta (IUnitOfWork.BeginTransactionAsync).");
        }
    }
}
