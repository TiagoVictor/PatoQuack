namespace PatoQuack.Domain.Channels;

/// <summary>
/// Porta de persistência dos canais de voz.
///
/// Os métodos "Locked" travam o canal até o fim da transação corrente
/// (<see cref="Abstractions.IUnitOfWork.BeginTransactionAsync"/>). Todas as operações que mudam
/// a presença num canal passam por esse lock, o que torna atômicos o "checar limite + inserir"
/// e o "checar transmissor + marcar".
/// </summary>
public interface IVoiceChannelRepository
{
    /// <summary>Canal rastreado (para alterar ou remover), ou null.</summary>
    Task<VoiceChannel?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Marca o canal para remoção. A presença nele vai junto.</summary>
    void Remove(VoiceChannel channel);

    /// <summary>Canais do servidor, em ordem de criação.</summary>
    Task<IReadOnlyList<VoiceChannel>> ListByServerAsync(Guid serverId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Se o servidor já tem um canal com esse nome (sem diferenciar maiúsculas), ignorando
    /// <paramref name="exceptChannelId"/> (para renomear um canal para o próprio nome).
    /// </summary>
    Task<bool> NameExistsAsync(Guid serverId, string name, Guid? exceptChannelId = null, CancellationToken cancellationToken = default);

    /// <summary>Marca o canal para inclusão (efetivada no SaveChanges).</summary>
    Task AddAsync(VoiceChannel channel, CancellationToken cancellationToken = default);

    /// <summary>Busca o canal travando-o, ou null se não existir. Exige transação aberta.</summary>
    Task<VoiceChannel?> GetLockedAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Busca, travando-o, o canal em que a conexão está, ou null. Exige transação aberta.</summary>
    Task<VoiceChannel?> GetLockedByParticipantAsync(string connectionId, CancellationToken cancellationToken = default);

    /// <summary>Encerra todas as transmissões imediatamente (usado ao reiniciar).</summary>
    Task ClearAllStreamersAsync(CancellationToken cancellationToken = default);
}
