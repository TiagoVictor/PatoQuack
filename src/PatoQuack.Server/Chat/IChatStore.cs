namespace PatoQuack.Server.Chat;

/// <summary>Mensagem guardada (o autor é o nome exibido no momento do envio).</summary>
public sealed record StoredChatMessage(long Id, int ChannelId, string AuthorName, string Text, DateTimeOffset SentAt);

/// <summary>
/// Onde as mensagens ficam. A implementação atual usa o banco da aplicação via EF Core (SQLite);
/// trocar de banco (ex.: PostgreSQL) é trocar o provedor do EF no Program.cs.
/// </summary>
public interface IChatStore
{
    Task<StoredChatMessage> AddAsync(int channelId, string authorName, string text, DateTimeOffset sentAt);

    /// <summary>
    /// As <paramref name="limit"/> mensagens mais recentes do canal com id menor que
    /// <paramref name="beforeId"/> (ou as mais recentes, se null), em ordem cronológica.
    /// </summary>
    Task<IReadOnlyList<StoredChatMessage>> GetRecentAsync(int channelId, int limit, long? beforeId = null);

    /// <summary>Apaga as mensagens enviadas antes de <paramref name="cutoff"/>. Retorna quantas.</summary>
    Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff);
}
