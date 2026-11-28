namespace PatoQuack.Domain.Participants;

/// <summary>Porta de persistência da presença nos canais.</summary>
public interface IParticipantRepository
{
    Task<Participant?> GetByConnectionIdAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>Participantes do canal, em ordem de entrada.</summary>
    Task<IReadOnlyList<Participant>> ListByChannelAsync(Guid channelId, CancellationToken cancellationToken = default);

    /// <summary>Conexões do usuário em canais do servidor (ex.: para tirá-lo da chamada ao sair do servidor).</summary>
    Task<IReadOnlyList<string>> ListConnectionsInServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default);

    /// <summary>Marca o participante para inclusão (efetivada no SaveChanges).</summary>
    Task AddAsync(Participant participant, CancellationToken cancellationToken = default);

    /// <summary>Marca o participante para remoção (efetivada no SaveChanges).</summary>
    void Remove(Participant participant);

    /// <summary>Apaga toda a presença imediatamente (usado ao reiniciar).</summary>
    Task DeleteAllAsync(CancellationToken cancellationToken = default);
}
