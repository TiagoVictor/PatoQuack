namespace PatoQuack.Server.Voice;

/// <summary>
/// Métodos que o servidor chama nos clientes. Usar um hub fortemente tipado evita
/// erro de digitação no nome dos eventos e documenta o protocolo em um lugar só.
/// Os nomes aqui são exatamente os que o JavaScript escuta com <c>connection.on(...)</c>.
/// </summary>
public interface IVoiceClient
{
    Task UserJoined(string connectionId, string name);
    Task UserLeft(string connectionId);
    Task UserMuted(string connectionId, bool muted);

    Task ReceiveOffer(string fromConnectionId, SessionDescriptionDto offer);
    Task ReceiveAnswer(string fromConnectionId, SessionDescriptionDto answer);
    Task ReceiveIceCandidate(string fromConnectionId, IceCandidateDto candidate);
}

/// <summary>Participante como o cliente o vê.</summary>
public sealed record ParticipantDto(string ConnectionId, string Name, bool Muted);

/// <summary>Equivalente ao <c>RTCSessionDescriptionInit</c> do navegador.</summary>
public sealed record SessionDescriptionDto(string Type, string Sdp);

/// <summary>Equivalente ao <c>RTCIceCandidateInit</c> do navegador.</summary>
public sealed record IceCandidateDto(string? Candidate, string? SdpMid, int? SdpMLineIndex, string? UsernameFragment);

public sealed class VoiceOptions
{
    public const string SectionName = "Voice";

    /// <summary>Limite de participantes por sala. Em malha P2P, 6 já é o teto prático.</summary>
    public int MaxParticipantsPerRoom { get; set; } = 6;
}
