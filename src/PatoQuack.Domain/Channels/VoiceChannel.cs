using PatoQuack.Domain.Common;

namespace PatoQuack.Domain.Channels;

/// <summary>
/// Canal de voz de um servidor. É permanente (sobrevive a quem entra e sai); guarda quem está
/// transmitindo vídeo (no máximo uma pessoa por canal).
/// </summary>
public sealed class VoiceChannel
{
    // Usado pelo EF Core para materializar a entidade.
    private VoiceChannel()
    {
        Name = string.Empty;
    }

    public VoiceChannel(Guid id, Guid serverId, string name, DateTimeOffset createdAt)
    {
        Name = DisplayName.Normalize(name) ?? throw new ArgumentException("Nome de canal inválido.", nameof(name));
        Id = id;
        ServerId = serverId;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    public Guid ServerId { get; private set; }

    public string Name { get; private set; }

    /// <summary>Conexão que transmite vídeo no canal, ou null.</summary>
    public string? StreamerConnectionId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public bool HasStreamer => StreamerConnectionId is not null;

    public bool IsStreamer(string connectionId) => StreamerConnectionId == connectionId;

    public void StartStream(string connectionId)
    {
        ArgumentException.ThrowIfNullOrEmpty(connectionId);
        if (HasStreamer)
        {
            throw new InvalidOperationException($"O canal '{Name}' já tem alguém transmitindo.");
        }

        StreamerConnectionId = connectionId;
    }

    public void StopStream() => StreamerConnectionId = null;

    public void Rename(string name) =>
        Name = DisplayName.Normalize(name) ?? throw new ArgumentException("Nome de canal inválido.", nameof(name));
}
