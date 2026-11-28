namespace PatoQuack.Domain.Chat;

/// <summary>Mensagem de texto num canal. O nome do autor é guardado como estava no envio.</summary>
public sealed class ChatMessage
{
    // Usado pelo EF Core para materializar a entidade.
    private ChatMessage()
    {
        AuthorName = string.Empty;
        Text = string.Empty;
    }

    public ChatMessage(Guid channelId, Guid authorId, string authorName, string text, DateTimeOffset sentAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(authorName);
        ArgumentException.ThrowIfNullOrWhiteSpace(text);
        ChannelId = channelId;
        AuthorId = authorId;
        AuthorName = authorName;
        Text = text;
        SentAt = sentAt;
    }

    /// <summary>Sequencial (gerado pelo banco): ordena as mensagens e serve de cursor do histórico.</summary>
    public long Id { get; private set; }

    public Guid ChannelId { get; private set; }

    public Guid AuthorId { get; private set; }

    public string AuthorName { get; private set; }

    public string Text { get; private set; }

    public DateTimeOffset SentAt { get; private set; }
}
