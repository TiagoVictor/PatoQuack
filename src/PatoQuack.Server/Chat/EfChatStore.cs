using Microsoft.EntityFrameworkCore;
using PatoQuack.Server.Data;

namespace PatoQuack.Server.Chat;

/// <summary>Mensagens do chat no banco da aplicação (EF Core; hoje SQLite).</summary>
public sealed class EfChatStore(AppDbContext db) : IChatStore
{
    public async Task<StoredChatMessage> AddAsync(string room, string authorName, string text, DateTimeOffset sentAt)
    {
        var message = new ChatMessage { Room = room, AuthorName = authorName, Text = text, SentAt = sentAt };
        db.ChatMessages.Add(message);
        await db.SaveChangesAsync();
        return ToStored(message);
    }

    public async Task<IReadOnlyList<StoredChatMessage>> GetRecentAsync(string room, int limit, long? beforeId = null)
    {
        var query = db.ChatMessages.AsNoTracking().Where(m => m.Room == room);
        if (beforeId is { } before)
        {
            query = query.Where(m => m.Id < before);
        }

        var newestFirst = await query.OrderByDescending(m => m.Id).Take(limit).ToListAsync();
        newestFirst.Reverse();
        return newestFirst.Select(ToStored).ToList();
    }

    public Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff) =>
        db.ChatMessages.Where(m => m.SentAt < cutoff).ExecuteDeleteAsync();

    private static StoredChatMessage ToStored(ChatMessage m) => new(m.Id, m.Room, m.AuthorName, m.Text, m.SentAt);
}
