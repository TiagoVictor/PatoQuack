using PatoQuack.Domain.Participants;

namespace PatoQuack.Application.Chat;

/// <summary>
/// Chat de texto do canal em que a conexão está. Cada ação confere de novo, no banco, que a pessoa
/// ainda é membro do servidor (pode ter saído ou o servidor pode ter sido apagado).
/// </summary>
public interface IChatService
{
    int MaxMessageLength { get; }

    Task<ChatSendResult> SendAsync(string connectionId, string? text, CancellationToken cancellationToken = default);

    /// <summary>Página do histórico do canal atual (as mais recentes antes de <paramref name="beforeId"/>). Null se não estiver num canal permitido.</summary>
    Task<ChatHistoryPage?> GetHistoryAsync(string connectionId, long? beforeId, CancellationToken cancellationToken = default);

    /// <summary>Quem pode avisar "digitando" agora (respeitando o limite), ou null.</summary>
    Task<Participant?> TryTypingAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>A conexão saiu: esquece os contadores dela.</summary>
    void Forget(string connectionId);

    /// <summary>Apaga mensagens mais antigas que a retenção. Retorna quantas (0 se a retenção estiver desligada).</summary>
    Task<int> DeleteExpiredAsync(CancellationToken cancellationToken = default);
}
