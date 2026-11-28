using PatoQuack.Domain.Chat;

namespace PatoQuack.Application.Chat;

public enum ChatSendStatus
{
    Sent,
    /// <summary>A conexão não está em nenhum canal.</summary>
    NotInChannel,
    /// <summary>Não é mais membro do servidor (ou não pode mandar mensagens nele).</summary>
    NotAllowed,
    Empty,
    TooLong,
    InvalidCharacters,
    TooFast,
}

/// <param name="Message">A mensagem gravada (quando <see cref="Status"/> é Sent).</param>
public sealed record ChatSendResult(ChatSendStatus Status, ChatMessage? Message = null);

/// <summary>Página do histórico, em ordem cronológica. HasMore = há mensagens mais antigas.</summary>
public sealed record ChatHistoryPage(IReadOnlyList<ChatMessage> Messages, bool HasMore);
