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

    Task StreamStarted(string connectionId, string name);
    Task StreamStopped(string connectionId);

    /// <summary>Só para quem transmite: alguém começou (true) ou parou (false) de assistir.</summary>
    Task ViewerChanged(string viewerConnectionId, bool watching);

    /// <summary>Mensagem de chat nova no canal (inclusive para quem enviou).</summary>
    Task ChatMessage(ChatMessageDto message);

    /// <summary>Alguém está digitando (para os outros do canal).</summary>
    Task UserTyping(string connectionId);

    /// <summary>O canal foi apagado (ou o servidor dele). Quem estava nele já saiu da presença.</summary>
    Task ChannelDeleted(string channelId);

    /// <summary>Você foi tirado do canal pelo servidor (ex.: saiu do servidor).</summary>
    Task Kicked(string reason);

    Task ReceiveOffer(string fromConnectionId, SessionDescriptionDto offer);
    Task ReceiveAnswer(string fromConnectionId, SessionDescriptionDto answer);
    Task ReceiveIceCandidate(string fromConnectionId, IceCandidateDto candidate);
}

/// <summary>
/// Mensagem como o cliente a vê. <see cref="AuthorConnectionId"/> só vem nas mensagens ao vivo
/// (o cliente sabe quais são dele e tira o "digitando"); no histórico é null.
/// </summary>
public sealed record ChatMessageDto(long Id, string AuthorName, string Text, DateTimeOffset SentAt, string? AuthorConnectionId);

/// <summary>Página do histórico, em ordem cronológica. HasMore = há mensagens mais antigas.</summary>
public sealed record ChatHistoryDto(IReadOnlyList<ChatMessageDto> Messages, bool HasMore);

/// <summary>Participante como o cliente o vê.</summary>
public sealed record ParticipantDto(string ConnectionId, string Name, bool Muted);

/// <summary>Quem está transmitindo vídeo no canal.</summary>
public sealed record StreamerDto(string ConnectionId, string Name);

/// <summary>Resposta do <c>JoinChannel</c>: quem já estava no canal e quem transmite (ou null).</summary>
public sealed record JoinChannelResultDto(IReadOnlyList<ParticipantDto> Participants, StreamerDto? Streamer);

/// <summary>Equivalente ao <c>RTCSessionDescriptionInit</c> do navegador.</summary>
public sealed record SessionDescriptionDto(string Type, string Sdp);

/// <summary>Equivalente ao <c>RTCIceCandidateInit</c> do navegador.</summary>
public sealed record IceCandidateDto(string? Candidate, string? SdpMid, int? SdpMLineIndex, string? UsernameFragment);
