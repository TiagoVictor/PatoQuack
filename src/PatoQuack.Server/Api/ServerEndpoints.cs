using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using PatoQuack.Application.Servers;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Servers;
using PatoQuack.Server.Auth;
using PatoQuack.Server.Voice;

namespace PatoQuack.Server.Api;

/// <summary>
/// API REST de servidores, canais e convites (adaptador de entrada HTTP). Tudo exige login; a
/// autorização por servidor (dono x membro) é decidida no <see cref="IServerService"/>. Erros saem
/// como ProblemDetails com a mensagem em "detail".
/// </summary>
public static class ServerEndpoints
{
    public static IEndpointRouteBuilder MapServerEndpoints(this IEndpointRouteBuilder app)
    {
        var servers = app.MapGroup("/api/servers").WithTags("Servers").RequireAuthorization()
            .AddEndpointFilter(ApiSecurity.RequireCsrfHeader);

        servers.MapGet("/", ListServersAsync);
        servers.MapPost("/", CreateServerAsync);
        servers.MapGet("/{serverId:guid}", GetServerAsync);
        servers.MapPatch("/{serverId:guid}", RenameServerAsync);
        servers.MapDelete("/{serverId:guid}", DeleteServerAsync);
        servers.MapPost("/{serverId:guid}/channels", CreateChannelAsync);
        servers.MapPatch("/{serverId:guid}/channels/{channelId:guid}", RenameChannelAsync);
        servers.MapDelete("/{serverId:guid}/channels/{channelId:guid}", DeleteChannelAsync);
        servers.MapGet("/{serverId:guid}/members", ListMembersAsync);
        servers.MapPost("/{serverId:guid}/leave", LeaveServerAsync);
        servers.MapGet("/{serverId:guid}/invites", ListInvitesAsync);
        servers.MapPost("/{serverId:guid}/invites", CreateInviteAsync);

        // Convites têm limite por IP: dificulta adivinhar códigos.
        var invites = app.MapGroup("/api/invites").WithTags("Invites").RequireAuthorization()
            .AddEndpointFilter(ApiSecurity.RequireCsrfHeader)
            .RequireRateLimiting(ApiSecurity.AuthRateLimitPolicy);

        invites.MapGet("/{inviteCode}", GetInviteAsync);
        invites.MapPost("/{inviteCode}/accept", AcceptInviteAsync);
        invites.MapDelete("/{inviteCode}", RevokeInviteAsync);

        return app;
    }

    private static async Task<Ok<List<ServerSummaryDto>>> ListServersAsync(
        IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var list = await service.ListServersAsync(http.User.GetUserId(), cancellationToken);
        return TypedResults.Ok(list.Select(s => new ServerSummaryDto(
            s.Server.Id, s.Server.Name, s.Server.IsOwner(http.User.GetUserId()))).ToList());
    }

    private static async Task<Results<Created<ServerDto>, ProblemHttpResult>> CreateServerAsync(
        NameRequest request, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.CreateServerAsync(http.User.GetUserId(), request.Name, cancellationToken);
        if (!result.Succeeded)
        {
            return Problem(result.Status, "servidor", service);
        }

        var dto = ToDto(result.Value!, http.User.GetUserId());
        return TypedResults.Created($"/api/servers/{dto.Id}", dto);
    }

    private static async Task<Results<Ok<ServerDto>, ProblemHttpResult>> GetServerAsync(
        Guid serverId, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.GetServerAsync(http.User.GetUserId(), serverId, cancellationToken);
        return result.Succeeded
            ? TypedResults.Ok(ToDto(result.Value!, http.User.GetUserId()))
            : Problem(result.Status, "servidor", service);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> RenameServerAsync(
        Guid serverId, NameRequest request, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.RenameServerAsync(http.User.GetUserId(), serverId, request.Name, cancellationToken);
        return result.Succeeded ? TypedResults.NoContent() : Problem(result.Status, "servidor", service);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteServerAsync(
        Guid serverId, IServerService service, IHubContext<VoiceHub, IVoiceClient> hub, HttpContext http,
        CancellationToken cancellationToken)
    {
        var result = await service.DeleteServerAsync(http.User.GetUserId(), serverId, cancellationToken);
        if (!result.Succeeded)
        {
            return Problem(result.Status, "servidor", service);
        }

        await NotifyChannelsDeletedAsync(hub, result.Value!);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Created<ChannelDto>, ProblemHttpResult>> CreateChannelAsync(
        Guid serverId, NameRequest request, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.CreateChannelAsync(http.User.GetUserId(), serverId, request.Name, cancellationToken);
        return result.Succeeded
            ? TypedResults.Created($"/api/servers/{serverId}/channels/{result.Value!.Id}", ToDto(result.Value))
            : Problem(result.Status, "canal", service);
    }

    private static async Task<Results<Ok<ChannelDto>, ProblemHttpResult>> RenameChannelAsync(
        Guid serverId, Guid channelId, NameRequest request, IServerService service, HttpContext http,
        CancellationToken cancellationToken)
    {
        var result = await service.RenameChannelAsync(http.User.GetUserId(), serverId, channelId, request.Name, cancellationToken);
        return result.Succeeded ? TypedResults.Ok(ToDto(result.Value!)) : Problem(result.Status, "canal", service);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteChannelAsync(
        Guid serverId, Guid channelId, IServerService service, IHubContext<VoiceHub, IVoiceClient> hub, HttpContext http,
        CancellationToken cancellationToken)
    {
        var result = await service.DeleteChannelAsync(http.User.GetUserId(), serverId, channelId, cancellationToken);
        if (!result.Succeeded)
        {
            return Problem(result.Status, "canal", service);
        }

        await NotifyChannelsDeletedAsync(hub, result.Value!);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<List<MemberDto>>, ProblemHttpResult>> ListMembersAsync(
        Guid serverId, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.ListMembersAsync(http.User.GetUserId(), serverId, cancellationToken);
        return result.Succeeded
            ? TypedResults.Ok(result.Value!.Select(m => new MemberDto(m.UserId, m.Name, m.Username, m.IsOwner)).ToList())
            : Problem(result.Status, "servidor", service);
    }

    /// <summary>Sai do servidor e o servidor tira a pessoa da chamada (se estiver num canal dele).</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> LeaveServerAsync(
        Guid serverId, IServerService service, VoicePresence presence, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.LeaveServerAsync(http.User.GetUserId(), serverId, cancellationToken);
        if (!result.Succeeded)
        {
            return Problem(result.Status, "servidor", service);
        }

        await presence.KickAsync(result.Value!, "Você saiu do servidor.");
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<List<ServerInviteDto>>, ProblemHttpResult>> ListInvitesAsync(
        Guid serverId, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.ListInvitesAsync(http.User.GetUserId(), serverId, cancellationToken);
        return result.Succeeded
            ? TypedResults.Ok(result.Value!.Select(ToDto).ToList())
            : Problem(result.Status, "servidor", service);
    }

    private static async Task<Results<Created<ServerInviteDto>, ProblemHttpResult>> CreateInviteAsync(
        Guid serverId, CreateInviteRequest request, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.CreateInviteAsync(http.User.GetUserId(), serverId, request.ExpiresInDays, request.MaxUses, cancellationToken);
        return result.Succeeded
            ? TypedResults.Created($"/api/invites/{result.Value!.Code}", ToDto(result.Value))
            : Problem(result.Status, "servidor", service);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> RevokeInviteAsync(
        string inviteCode, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var result = await service.RevokeInviteAsync(http.User.GetUserId(), inviteCode, cancellationToken);
        return result.Status switch
        {
            ServerOperationStatus.Succeeded => TypedResults.NoContent(),
            ServerOperationStatus.NotFound => InviteNotFound(),
            _ => Problem(result.Status, "servidor", service),
        };
    }

    private static async Task<Results<Ok<InviteDto>, ProblemHttpResult>> GetInviteAsync(
        string inviteCode, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var invite = await service.GetInviteAsync(http.User.GetUserId(), inviteCode, cancellationToken);
        return invite is null
            ? InviteNotFound()
            : TypedResults.Ok(new InviteDto(invite.ServerId, invite.ServerName, invite.AlreadyMember));
    }

    private static async Task<Results<Ok<AcceptInviteDto>, ProblemHttpResult>> AcceptInviteAsync(
        string inviteCode, IServerService service, HttpContext http, CancellationToken cancellationToken)
    {
        var serverId = await service.AcceptInviteAsync(http.User.GetUserId(), inviteCode, cancellationToken);
        return serverId is { } id ? TypedResults.Ok(new AcceptInviteDto(id)) : InviteNotFound();
    }

    /// <summary>Quem estava num canal apagado recebe ChannelDeleted e sai (a presença já foi apagada no banco).</summary>
    private static Task NotifyChannelsDeletedAsync(IHubContext<VoiceHub, IVoiceClient> hub, DeletedChannels deleted) =>
        Task.WhenAll(deleted.ChannelIds.Select(id => hub.Clients.Group(VoiceHub.GroupName(id)).ChannelDeleted(id.ToString())));

    private static ServerDto ToDto(ServerDetails details, Guid userId) => new(
        details.Server.Id,
        details.Server.Name,
        details.Server.IsOwner(userId),
        PermissionNames(details.Permissions),
        details.Channels.Select(ToDto).ToList());

    private static ChannelDto ToDto(VoiceChannel channel) => new(channel.Id, channel.Name);

    private static ServerInviteDto ToDto(ServerInvite invite) =>
        new(invite.Code, invite.CreatedAt, invite.ExpiresAt, invite.MaxUses, invite.Uses);

    private static List<string> PermissionNames(ServerPermission permissions) =>
        Enum.GetValues<ServerPermission>()
            .Where(p => p is not ServerPermission.None and not ServerPermission.All && permissions.HasFlag(p))
            .Select(p => char.ToLowerInvariant(p.ToString()[0]) + p.ToString()[1..])
            .ToList();

    private static ProblemHttpResult InviteNotFound() => TypedResults.Problem(
        statusCode: StatusCodes.Status404NotFound, title: "Convite inválido",
        detail: "Esse convite não existe, venceu, esgotou ou foi revogado. Peça um novo.");

    private static ProblemHttpResult Problem(ServerOperationStatus status, string what, IServerService service) => status switch
    {
        ServerOperationStatus.NotFound => TypedResults.Problem(statusCode: StatusCodes.Status404NotFound,
            title: "Não encontrado", detail: what == "canal" ? "Canal não encontrado." : "Servidor não encontrado."),
        ServerOperationStatus.Forbidden => TypedResults.Problem(statusCode: StatusCodes.Status403Forbidden,
            title: "Sem permissão", detail: "Só o dono do servidor pode fazer isso."),
        ServerOperationStatus.InvalidName => TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Nome inválido", detail: $"Nome de {what} inválido. Use de 1 a {DisplayName.MaxLength} caracteres."),
        ServerOperationStatus.NameTaken => TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
            title: "Canal já existe", detail: "Já existe um canal com esse nome neste servidor."),
        ServerOperationStatus.InvalidInviteOptions => TypedResults.Problem(statusCode: StatusCodes.Status400BadRequest,
            title: "Opções inválidas", detail: "Validade (1, 7 ou 30 dias) ou limite de usos (1, 10 ou sem limite) inválido."),
        ServerOperationStatus.OwnerCannotLeave => TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
            title: "Dono não sai", detail: "O dono não pode sair do próprio servidor. Para encerrar, exclua o servidor."),
        ServerOperationStatus.TooManyChannels => TypedResults.Problem(statusCode: StatusCodes.Status409Conflict,
            title: "Limite de canais", detail: $"Este servidor já tem o máximo de {service.MaxChannelsPerServer} canais."),
        _ => throw new InvalidOperationException($"Status inesperado: {status}"),
    };
}
