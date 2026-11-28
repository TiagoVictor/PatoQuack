namespace PatoQuack.Domain.Chat;

/// <summary>Porta de persistência das mensagens de chat.</summary>
public interface IChatMessageRepository
{
    /// <summary>Marca a mensagem para inclusão (o Id sai do banco no SaveChanges).</summary>
    Task AddAsync(ChatMessage message, CancellationToken cancellationToken = default);

    /// <summary>
    /// As <paramref name="limit"/> mensagens mais recentes do canal com Id menor que
    /// <paramref name="beforeId"/> (ou as mais recentes, se null), em ordem cronológica.
    /// </summary>
    Task<IReadOnlyList<ChatMessage>> ListRecentAsync(Guid channelId, int limit, long? beforeId, CancellationToken cancellationToken = default);

    /// <summary>Apaga as mensagens enviadas antes de <paramref name="cutoff"/>. Retorna quantas.</summary>
    Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff, CancellationToken cancellationToken = default);
}
