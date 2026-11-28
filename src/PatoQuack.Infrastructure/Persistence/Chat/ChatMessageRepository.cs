using Microsoft.EntityFrameworkCore;
using PatoQuack.Domain.Chat;

namespace PatoQuack.Infrastructure.Persistence.Chat;

internal sealed class ChatMessageRepository(PatoQuackDbContext db) : IChatMessageRepository
{
    public async Task AddAsync(ChatMessage message, CancellationToken cancellationToken = default) =>
        await db.ChatMessages.AddAsync(message, cancellationToken);

    public async Task<IReadOnlyList<ChatMessage>> ListRecentAsync(Guid channelId, int limit, long? beforeId, CancellationToken cancellationToken = default)
    {
        var query = db.ChatMessages.AsNoTracking().Where(m => m.ChannelId == channelId);
        if (beforeId is { } before)
        {
            query = query.Where(m => m.Id < before);
        }

        var newestFirst = await query.OrderByDescending(m => m.Id).Take(limit).ToListAsync(cancellationToken);
        newestFirst.Reverse();
        return newestFirst;
    }

    public Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff, CancellationToken cancellationToken = default) =>
        db.ChatMessages.Where(m => m.SentAt < cutoff).ExecuteDeleteAsync(cancellationToken);
}
