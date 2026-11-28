using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Application.Servers;

/// <summary>
/// Casos de uso de servidores, canais e convites, sempre em nome de um usuário. Cada operação
/// confere a <see cref="ServerPermission"/> necessária; quem não é membro recebe NotFound.
/// </summary>
public interface IServerService
{
    int MaxChannelsPerServer { get; }

    Task<IReadOnlyList<ServerSummary>> ListServersAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Cria o servidor (o usuário vira dono e membro) com o canal padrão.</summary>
    Task<ServerOperationResult<ServerDetails>> CreateServerAsync(Guid userId, string? name, CancellationToken cancellationToken = default);

    Task<ServerOperationResult<ServerDetails>> GetServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default);

    Task<ServerOperationResult<Server>> RenameServerAsync(Guid userId, Guid serverId, string? name, CancellationToken cancellationToken = default);

    Task<ServerOperationResult<DeletedChannels>> DeleteServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default);

    Task<ServerOperationResult<VoiceChannel>> CreateChannelAsync(Guid userId, Guid serverId, string? name, CancellationToken cancellationToken = default);

    Task<ServerOperationResult<VoiceChannel>> RenameChannelAsync(Guid userId, Guid serverId, Guid channelId, string? name, CancellationToken cancellationToken = default);

    Task<ServerOperationResult<DeletedChannels>> DeleteChannelAsync(Guid userId, Guid serverId, Guid channelId, CancellationToken cancellationToken = default);

    /// <summary>Membros do servidor (exige <see cref="ServerPermission.ViewMembers"/>).</summary>
    Task<ServerOperationResult<IReadOnlyList<ServerMemberView>>> ListMembersAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sai do servidor. O dono não pode (recebe OwnerCannotLeave). Quem chama deve tirar as conexões
    /// dele da chamada (<see cref="ServerOperationResult{T}.Value"/> = conexões nos canais do servidor).
    /// </summary>
    Task<ServerOperationResult<IReadOnlyList<string>>> LeaveServerAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Cria um convite (exige <see cref="ServerPermission.ManageInvites"/>). Validade em dias (1, 7 ou 30)
    /// e limite de usos (1, 10 ou null = sem limite); sem nenhum dos dois, vale o padrão (7 dias, 10 pessoas).
    /// </summary>
    Task<ServerOperationResult<ServerInvite>> CreateInviteAsync(Guid userId, Guid serverId, int? expiresInDays, int? maxUses, CancellationToken cancellationToken = default);

    /// <summary>Convites ainda usáveis do servidor (exige <see cref="ServerPermission.ManageInvites"/>).</summary>
    Task<ServerOperationResult<IReadOnlyList<ServerInvite>>> ListInvitesAsync(Guid userId, Guid serverId, CancellationToken cancellationToken = default);

    /// <summary>Revoga o convite (exige <see cref="ServerPermission.ManageInvites"/> no servidor dele).</summary>
    Task<ServerOperationResult<ServerInvite>> RevokeInviteAsync(Guid userId, string? inviteCode, CancellationToken cancellationToken = default);

    /// <summary>Dados do convite, ou null se ele não existir, tiver vencido, esgotado ou sido revogado (para quem já é membro, sempre mostra).</summary>
    Task<InvitePreview?> GetInviteAsync(Guid userId, string? inviteCode, CancellationToken cancellationToken = default);

    /// <summary>
    /// Torna o usuário membro, gastando um uso de forma atômica. Quem já é membro só recebe o id do
    /// servidor (sem gastar uso). Null se o convite não existir ou não valer mais.
    /// </summary>
    Task<Guid?> AcceptInviteAsync(Guid userId, string? inviteCode, CancellationToken cancellationToken = default);
}
