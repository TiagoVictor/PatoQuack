namespace PatoQuack.Server.Chat;

/// <summary>
/// Mensagem como o cliente a vê. <see cref="AuthorConnectionId"/> só vem nas mensagens ao vivo
/// (permite ao cliente saber quais são dele e tirar o "digitando"); no histórico é null.
/// </summary>
public sealed record ChatMessageDto(long Id, string AuthorName, string Text, DateTimeOffset SentAt, string? AuthorConnectionId)
{
    public static ChatMessageDto From(StoredChatMessage message, string? authorConnectionId = null) =>
        new(message.Id, message.AuthorName, message.Text, message.SentAt, authorConnectionId);
}

/// <summary>Página do histórico, em ordem cronológica. HasMore = há mensagens mais antigas.</summary>
public sealed record ChatHistoryDto(IReadOnlyList<ChatMessageDto> Messages, bool HasMore);
