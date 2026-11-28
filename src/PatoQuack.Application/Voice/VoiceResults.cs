using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Participants;

namespace PatoQuack.Application.Voice;

public enum JoinStatus
{
    Joined,
    ChannelNotFound,
    /// <summary>O usuário não tem permissão de voz no servidor do canal (não é membro).</summary>
    NotAllowed,
    ChannelFull,
    AlreadyInChannel,
}

/// <param name="Status">Resultado.</param>
/// <param name="Self">Quem entrou (null se não entrou).</param>
/// <param name="ExistingParticipants">Quem já estava no canal, sem incluir quem entrou.</param>
/// <param name="Streamer">Quem transmite vídeo no canal no momento da entrada, ou null.</param>
public sealed record JoinResult(
    JoinStatus Status,
    Participant? Self,
    IReadOnlyList<Participant> ExistingParticipants,
    Participant? Streamer = null)
{
    public static JoinResult NotFound { get; } = new(JoinStatus.ChannelNotFound, null, []);
    public static JoinResult NotAllowed { get; } = new(JoinStatus.NotAllowed, null, []);
    public static JoinResult Full { get; } = new(JoinStatus.ChannelFull, null, []);
    public static JoinResult AlreadyInChannel { get; } = new(JoinStatus.AlreadyInChannel, null, []);
}

/// <param name="Participant">Quem saiu.</param>
/// <param name="WasStreaming">Se a pessoa estava transmitindo (a transmissão foi encerrada).</param>
public sealed record LeaveResult(Participant Participant, bool WasStreaming);

public enum StreamStartStatus
{
    Started,
    NotInChannel,
    AlreadyStreaming,
}

/// <param name="Status">Resultado.</param>
/// <param name="Self">Quem pediu para transmitir (null se não estiver em canal).</param>
/// <param name="CurrentStreamer">Quem já transmite, quando o status é <see cref="StreamStartStatus.AlreadyStreaming"/>.</param>
public sealed record StreamStartResult(StreamStartStatus Status, Participant? Self, Participant? CurrentStreamer = null);

/// <summary>Canal travado junto com o participante que está nele.</summary>
internal readonly record struct LockedPresence(Participant Self, VoiceChannel Channel);
