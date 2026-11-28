using PatoQuack.Domain.Common;

namespace PatoQuack.Domain.Participants;

/// <summary>Presença de uma conexão num canal de voz. Some quando a conexão sai ou cai.</summary>
public sealed class Participant
{
    public const int MaxConnectionIdLength = 128;

    // Usado pelo EF Core para materializar a entidade.
    private Participant()
    {
        ConnectionId = string.Empty;
        Name = string.Empty;
    }

    public Participant(string connectionId, Guid userId, string name, Guid channelId, DateTimeOffset joinedAt)
    {
        ArgumentException.ThrowIfNullOrEmpty(connectionId);
        ConnectionId = connectionId;
        UserId = userId;
        Name = DisplayName.Normalize(name) ?? throw new ArgumentException("Nome inválido.", nameof(name));
        ChannelId = channelId;
        JoinedAt = joinedAt;
    }

    /// <summary>Id da conexão SignalR (identifica o peer na sinalização).</summary>
    public string ConnectionId { get; private set; }

    /// <summary>Usuário dono da conexão (a mesma pessoa pode estar em várias abas).</summary>
    public Guid UserId { get; private set; }

    /// <summary>Nome de exibição no momento da entrada.</summary>
    public string Name { get; private set; }

    public Guid ChannelId { get; private set; }

    /// <summary>Se o participante está com o microfone mutado.</summary>
    public bool Muted { get; private set; }

    public DateTimeOffset JoinedAt { get; private set; }

    public void SetMuted(bool muted) => Muted = muted;
}
