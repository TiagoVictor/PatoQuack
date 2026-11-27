using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PatoQuack.Server.Auth;
using PatoQuack.Server.Data;
using PatoQuack.Server.Voice;
using ServerEntity = PatoQuack.Server.Data.Server; // "Server" colide com o namespace PatoQuack.Server

namespace PatoQuack.Server.Servers;

public sealed record CreateServerRequest(string? Name);
public sealed record CreateInviteRequest(int? ExpiresInDays, int? MaxUses);

public sealed record ChannelDto(int Id, string Name, string Kind);
public sealed record ServerDto(int Id, string Name, bool IsOwner, IReadOnlyList<ChannelDto> Channels);
public sealed record MemberDto(string UserId, string DisplayName, bool IsOwner);
public sealed record ServerInviteDto(string Code, string Url, DateTimeOffset ExpiresAt, int? MaxUses, int Uses, string CreatedBy);
public sealed record InviteInfoDto(bool Valid, string? ServerName, string? InviterName, int? MemberCount, bool AlreadyMember);
public sealed record AcceptedDto(int ServerId);

/// <summary>
/// Servidores, membros e convites (/api/servers, /api/invites). Tudo exige login, exceto ver um
/// convite. Quem não é membro recebe 404 (não revelamos que o servidor existe).
/// </summary>
public static class ServerEndpoints
{
    public static readonly int[] InviteDays = [1, 7, 30];
    public static readonly int?[] InviteUses = [1, 10, null];
    private const int DefaultInviteDays = 7;
    private const int DefaultInviteUses = 10;
    private const int MaxServersPerUser = 50;

    public static void MapServerEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api").AddEndpointFilter(AuthEndpoints.RequireCsrfHeader);

        var servers = api.MapGroup("/servers").RequireAuthorization();
        servers.MapGet("/", ListServers);
        servers.MapPost("/", CreateServer);
        servers.MapPatch("/{id:int}", RenameServer);
        servers.MapDelete("/{id:int}", DeleteServer);
        servers.MapPost("/{id:int}/leave", LeaveServer);
        servers.MapGet("/{id:int}/members", ListMembers);
        servers.MapPost("/{id:int}/invites", CreateInvite);
        servers.MapGet("/{id:int}/invites", ListInvites);

        api.MapGet("/invites/{code}", GetInvite).RequireRateLimiting(AuthEndpoints.RateLimitPolicy);
        api.MapPost("/invites/{code}/accept", AcceptInvite).RequireAuthorization().RequireRateLimiting(AuthEndpoints.RateLimitPolicy);
        api.MapDelete("/invites/{code}", RevokeInvite).RequireAuthorization();
    }

    private static string UserId(ClaimsPrincipal p) => p.FindFirstValue(ClaimTypes.NameIdentifier)!;

    private static IResult Error(string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new ErrorDto(message), statusCode: status);

    private static IResult NotFound() => Error("Servidor não encontrado.", StatusCodes.Status404NotFound);

    private static Task<ServerMember?> MembershipAsync(AppDbContext db, int serverId, string userId) =>
        db.ServerMembers.FirstOrDefaultAsync(m => m.ServerId == serverId && m.UserId == userId);

    /// <summary>Nome de servidor: 1 a 40 caracteres, sem caracteres de controle.</summary>
    public static bool TryNormalizeName(string? raw, out string name)
    {
        name = (raw ?? string.Empty).Trim();
        return name.Length is >= 1 and <= 40 && !name.Any(char.IsControl);
    }

    private static string RoomOf(int channelId) => channelId.ToString(CultureInfo.InvariantCulture);

    public static bool InviteUsable(ServerInvite i, DateTimeOffset now) =>
        i.RevokedAt is null && i.ExpiresAt > now && (i.MaxUses is null || i.Uses < i.MaxUses);

    public static string InviteUrl(string baseUrl, string code) => $"{baseUrl}/auth.html?modo=convite&convite={code}";

    // ---- servidores -------------------------------------------------------------

    private static async Task<IResult> ListServers(ClaimsPrincipal principal, AppDbContext db)
    {
        var userId = UserId(principal);
        var list = await db.ServerMembers.AsNoTracking()
            .Where(m => m.UserId == userId)
            .OrderBy(m => m.JoinedAt)
            .Select(m => new
            {
                m.Server!.Id,
                m.Server.Name,
                IsOwner = m.Role == ServerRole.Owner,
                Channels = m.Server.Channels.OrderBy(c => c.Position).ThenBy(c => c.Id)
                    .Select(c => new { c.Id, c.Name, c.Kind }).ToList(),
            })
            .ToListAsync();
        return Results.Ok(list.Select(s => new ServerDto(s.Id, s.Name, s.IsOwner,
            s.Channels.Select(c => new ChannelDto(c.Id, c.Name, c.Kind == ChannelKind.Voice ? "voice" : "text")).ToList())));
    }

    private static async Task<IResult> CreateServer(CreateServerRequest body, ClaimsPrincipal principal, AppDbContext db, TimeProvider time)
    {
        if (!TryNormalizeName(body.Name, out var name))
        {
            return Error("O nome do servidor precisa ter de 1 a 40 caracteres.");
        }

        var userId = UserId(principal);
        if (await db.ServerMembers.CountAsync(m => m.UserId == userId) >= MaxServersPerUser)
        {
            return Error($"Você já está em {MaxServersPerUser} servidores (o máximo).");
        }

        var now = time.GetUtcNow();
        var server = new ServerEntity
        {
            Name = name,
            OwnerId = userId,
            CreatedAt = now,
            Members = [new ServerMember { UserId = userId, Role = ServerRole.Owner, JoinedAt = now }],
            // Todo servidor nasce com um canal de voz (criar/renomear canais vem na próxima fase).
            Channels = [new Channel { Name = "Geral", Kind = ChannelKind.Voice, Position = 0 }],
        };
        db.Servers.Add(server);
        await db.SaveChangesAsync();
        return Results.Ok(new ServerDto(server.Id, server.Name, true,
            server.Channels.Select(c => new ChannelDto(c.Id, c.Name, "voice")).ToList()));
    }

    private static async Task<IResult> RenameServer(int id, CreateServerRequest body, ClaimsPrincipal principal, AppDbContext db)
    {
        var membership = await MembershipAsync(db, id, UserId(principal));
        if (membership is null) return NotFound();
        if (membership.Role != ServerRole.Owner) return Error("Só o dono pode renomear o servidor.", StatusCodes.Status403Forbidden);
        if (!TryNormalizeName(body.Name, out var name)) return Error("O nome do servidor precisa ter de 1 a 40 caracteres.");

        await db.Servers.Where(s => s.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.Name, name));
        return Results.Ok();
    }

    private static async Task<IResult> DeleteServer(int id, ClaimsPrincipal principal, AppDbContext db, VoicePresence presence)
    {
        var membership = await MembershipAsync(db, id, UserId(principal));
        if (membership is null) return NotFound();
        if (membership.Role != ServerRole.Owner) return Error("Só o dono pode apagar o servidor.", StatusCodes.Status403Forbidden);

        var rooms = await db.Channels.Where(c => c.ServerId == id).Select(c => c.Id).ToListAsync();
        var server = await db.Servers.FirstAsync(s => s.Id == id);
        db.Servers.Remove(server); // canais, membros, convites e mensagens vão junto (cascata)
        await db.SaveChangesAsync();
        await presence.EvictRoomsAsync(rooms.Select(RoomOf), "O servidor foi apagado.");
        return Results.Ok();
    }

    private static async Task<IResult> LeaveServer(int id, ClaimsPrincipal principal, AppDbContext db, VoicePresence presence)
    {
        var userId = UserId(principal);
        var membership = await MembershipAsync(db, id, userId);
        if (membership is null) return NotFound();
        if (membership.Role == ServerRole.Owner)
        {
            return Error("O dono não pode sair do próprio servidor. Para encerrar, apague o servidor.", StatusCodes.Status409Conflict);
        }

        db.ServerMembers.Remove(membership);
        await db.SaveChangesAsync();
        var rooms = await db.Channels.Where(c => c.ServerId == id).Select(c => c.Id).ToListAsync();
        await presence.EvictUserAsync(userId, rooms.Select(RoomOf).ToList(), "Você saiu do servidor.");
        return Results.Ok();
    }

    private static async Task<IResult> ListMembers(int id, ClaimsPrincipal principal, AppDbContext db)
    {
        if (await MembershipAsync(db, id, UserId(principal)) is null) return NotFound();
        var members = await db.ServerMembers.AsNoTracking()
            .Where(m => m.ServerId == id)
            .OrderByDescending(m => m.Role).ThenBy(m => m.User!.DisplayName)
            .Select(m => new MemberDto(m.UserId, m.User!.DisplayName, m.Role == ServerRole.Owner))
            .ToListAsync();
        return Results.Ok(members);
    }

    // ---- convites ------------------------------------------------------------------

    private static async Task<IResult> CreateInvite(
        int id, CreateInviteRequest body, ClaimsPrincipal principal, HttpRequest request, AppDbContext db,
        UserManager<AppUser> users, AppLinks links, TimeProvider time)
    {
        var userId = UserId(principal);
        if (await MembershipAsync(db, id, userId) is null) return NotFound();

        var days = body.ExpiresInDays ?? DefaultInviteDays;
        var maxUses = body.ExpiresInDays is null && body.MaxUses is null ? DefaultInviteUses : body.MaxUses;
        if (!InviteDays.Contains(days) || !InviteUses.Contains(maxUses))
        {
            return Error("Validade ou limite de usos inválido.");
        }

        var now = time.GetUtcNow();
        var invite = new ServerInvite { Code = AppLinks.NewInviteCode(), ServerId = id, CreatedById = userId, CreatedAt = now, ExpiresAt = now.AddDays(days), MaxUses = maxUses };
        db.ServerInvites.Add(invite);
        await db.SaveChangesAsync();
        var me = await users.GetUserAsync(principal);
        return Results.Ok(new ServerInviteDto(invite.Code, InviteUrl(links.BaseUrl(request), invite.Code), invite.ExpiresAt, invite.MaxUses, 0, me?.DisplayName ?? string.Empty));
    }

    private static async Task<IResult> ListInvites(int id, ClaimsPrincipal principal, HttpRequest request, AppDbContext db, AppLinks links, TimeProvider time)
    {
        var membership = await MembershipAsync(db, id, UserId(principal));
        if (membership is null) return NotFound();
        if (membership.Role != ServerRole.Owner) return Error("Só o dono vê os convites do servidor.", StatusCodes.Status403Forbidden);

        var now = time.GetUtcNow();
        var baseUrl = links.BaseUrl(request);
        var all = await db.ServerInvites.AsNoTracking().Include(i => i.CreatedBy).Where(i => i.ServerId == id).ToListAsync();
        return Results.Ok(all.Where(i => InviteUsable(i, now)).OrderByDescending(i => i.CreatedAt)
            .Select(i => new ServerInviteDto(i.Code, InviteUrl(baseUrl, i.Code), i.ExpiresAt, i.MaxUses, i.Uses, i.CreatedBy?.DisplayName ?? string.Empty)));
    }

    private static async Task<IResult> RevokeInvite(string code, ClaimsPrincipal principal, AppDbContext db, TimeProvider time)
    {
        var userId = UserId(principal);
        var invite = await db.ServerInvites.FirstOrDefaultAsync(i => i.Code == code);
        if (invite is null) return Error("Convite não encontrado.", StatusCodes.Status404NotFound);
        var membership = await MembershipAsync(db, invite.ServerId, userId);
        // Revoga quem criou o convite ou o dono do servidor.
        if (membership is null || (invite.CreatedById != userId && membership.Role != ServerRole.Owner))
        {
            return Error("Convite não encontrado.", StatusCodes.Status404NotFound);
        }

        invite.RevokedAt = time.GetUtcNow();
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    private static async Task<IResult> GetInvite(string code, ClaimsPrincipal principal, AppDbContext db, TimeProvider time)
    {
        var invite = await db.ServerInvites.AsNoTracking()
            .Include(i => i.Server).Include(i => i.CreatedBy)
            .FirstOrDefaultAsync(i => i.Code == code);
        if (invite is null || !InviteUsable(invite, time.GetUtcNow()))
        {
            return Results.Ok(new InviteInfoDto(false, null, null, null, false));
        }

        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var count = await db.ServerMembers.CountAsync(m => m.ServerId == invite.ServerId);
        var already = userId is not null && await db.ServerMembers.AnyAsync(m => m.ServerId == invite.ServerId && m.UserId == userId);
        return Results.Ok(new InviteInfoDto(true, invite.Server!.Name, invite.CreatedBy?.DisplayName, count, already));
    }

    private static async Task<IResult> AcceptInvite(string code, ClaimsPrincipal principal, AppDbContext db, TimeProvider time)
    {
        var userId = UserId(principal);
        var now = time.GetUtcNow();
        var invite = await db.ServerInvites.AsNoTracking().FirstOrDefaultAsync(i => i.Code == code);
        // Já é membro: só leva ao servidor (mesmo com o convite esgotado; não gasta um uso).
        if (invite is not null && await MembershipAsync(db, invite.ServerId, userId) is not null)
        {
            return Results.Ok(new AcceptedDto(invite.ServerId));
        }

        if (invite is null || !InviteUsable(invite, now))
        {
            return Error("Convite inválido, vencido ou esgotado. Peça um novo.");
        }

        if (!await TryConsumeUseAsync(db, invite.Id))
        {
            return Error("Convite inválido, vencido ou esgotado. Peça um novo.");
        }

        db.ServerMembers.Add(new ServerMember { ServerId = invite.ServerId, UserId = userId, Role = ServerRole.Member, JoinedAt = now });
        await db.SaveChangesAsync();
        return Results.Ok(new AcceptedDto(invite.ServerId));
    }

    /// <summary>
    /// Gasta um uso do convite de forma atômica: a atualização só vale se ainda houver usos e o
    /// convite não tiver sido revogado (dois aceites simultâneos não passam do limite).
    /// </summary>
    public static async Task<bool> TryConsumeUseAsync(AppDbContext db, int inviteId) =>
        await db.ServerInvites
            .Where(i => i.Id == inviteId && i.RevokedAt == null && (i.MaxUses == null || i.Uses < i.MaxUses))
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.Uses, i => i.Uses + 1)) == 1;

    public static Task ReleaseUseAsync(AppDbContext db, int inviteId) =>
        db.ServerInvites.Where(i => i.Id == inviteId && i.Uses > 0)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.Uses, i => i.Uses - 1));
}
