using PatoQuack.Domain.Participants;

namespace PatoQuack.Application.Voice;

/// <summary>
/// Casos de uso da presença em canais de voz: entrar, sair, mutar e transmitir. O hub SignalR
/// (ou qualquer outro adaptador) depende só desta interface.
/// </summary>
public interface IVoiceSessionService
{
    int MaxParticipantsPerChannel { get; }

    /// <summary>
    /// Coloca a conexão do usuário no canal se ele existir, o usuário puder entrar na voz daquele
    /// servidor e houver vaga. A checagem de capacidade e a inserção são atômicas.
    /// </summary>
    Task<JoinResult> JoinAsync(string connectionId, Guid userId, Guid channelId, CancellationToken cancellationToken = default);

    /// <summary>Tira a conexão do canal em que estiver (encerrando a transmissão, se houver). Null se não estava em canal.</summary>
    Task<LeaveResult?> LeaveAsync(string connectionId, CancellationToken cancellationToken = default);

    Task<Participant?> GetParticipantAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>Quem transmite no canal da conexão (pode ser ela mesma), ou null.</summary>
    Task<Participant?> GetChannelStreamerAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>Atualiza o estado de mute. Retorna o participante atualizado, ou null se não estiver em canal.</summary>
    Task<Participant?> SetMutedAsync(string connectionId, bool muted, CancellationToken cancellationToken = default);

    /// <summary>Marca a conexão como quem transmite vídeo no canal dela. No máximo uma por canal (atômico).</summary>
    Task<StreamStartResult> StartStreamAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>Encerra a transmissão. Retorna o participante se ele estava transmitindo, ou null.</summary>
    Task<Participant?> StopStreamAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Apaga toda a presença (e as transmissões). Chamado na subida do servidor: as conexões
    /// SignalR anteriores morreram junto com o processo. Servidores e canais são mantidos.
    /// </summary>
    Task ResetPresenceAsync(CancellationToken cancellationToken = default);
}
