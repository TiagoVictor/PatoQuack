using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Application.Voice;
using PatoQuack.Server.Tests.Infrastructure;

namespace PatoQuack.Server.Tests.Voice;

/// <summary>
/// Presença em canais contra um PostgreSQL real: capacidade, isolamento, mute, transmissão e
/// concorrência (o lock por canal é do banco, então só faz sentido testar com o banco).
/// Cada chamada usa um escopo próprio, como cada invocação do hub em produção.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class VoiceSessionServiceTests(PostgresFixture db)
{
    // Conexões únicas por teste: o banco é compartilhado pela coleção.
    private readonly string _prefix = Guid.NewGuid().ToString("N")[..8];

    private string Conn(string id) => $"{_prefix}-{id}";

    // Usuários membros por nome dentro do teste (Ana, Bia...), todos no mesmo servidor.
    private readonly ConcurrentDictionary<string, Lazy<Task<Guid>>> _users = new();
    private TestServer? _server;

    private string? _invite;

    private async Task<Guid> ChannelAsync()
    {
        if (_server is null)
        {
            _server = await db.CreateServerAsync();
            _invite = await db.CreateUnlimitedInviteAsync(_server);
        }

        return _server.ChannelId;
    }

    /// <summary>Outro canal no mesmo servidor.</summary>
    private async Task<Guid> OtherChannelAsync()
    {
        await ChannelAsync();
        await using var services = db.CreateServices();
        await using var scope = services.CreateAsyncScope();
        var result = await scope.ServiceProvider.GetRequiredService<PatoQuack.Application.Servers.IServerService>()
            .CreateChannelAsync(_server!.OwnerId, _server.ServerId, $"c{Guid.NewGuid():N}"[..10]);
        return result.Value!.Id;
    }

    // Seguro para chamadas em paralelo (os testes de concorrência criam usuários em Task.Run).
    private async Task<Guid> UserAsync(string name)
    {
        await ChannelAsync();
        return await _users.GetOrAdd(name, n => new Lazy<Task<Guid>>(() => db.CreateMemberAsync(_invite!, n))).Value;
    }

    [Fact]
    public async Task Join_returns_participants_already_in_channel()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();

        var first = await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), channel));
        var second = await RunAsync(services, async s => await s.JoinAsync(Conn("b"), await UserAsync("Bia"), channel));

        Assert.Equal(JoinStatus.Joined, first.Status);
        Assert.Empty(first.ExistingParticipants);
        Assert.Equal(JoinStatus.Joined, second.Status);
        Assert.Equal(Conn("a"), Assert.Single(second.ExistingParticipants).ConnectionId);
    }

    [Fact]
    public async Task Channels_are_isolated()
    {
        await using var services = db.CreateServices();
        var one = await ChannelAsync();
        var two = await OtherChannelAsync();

        await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), one));
        var other = await RunAsync(services, async s => await s.JoinAsync(Conn("b"), await UserAsync("Bia"), two));

        Assert.Empty(other.ExistingParticipants);
    }

    [Fact]
    public async Task Join_fails_for_unknown_channel()
    {
        await using var services = db.CreateServices();

        var result = await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), Guid.NewGuid()));

        Assert.Equal(JoinStatus.ChannelNotFound, result.Status);
        Assert.Null(await RunAsync(services, s => s.GetParticipantAsync(Conn("a"))));
    }

    [Fact]
    public async Task Join_is_refused_to_non_members()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();
        var stranger = (await db.CreateUserAsync("Estranho")).Id;

        var result = await RunAsync(services, s => s.JoinAsync(Conn("x"), stranger, channel));

        Assert.Equal(JoinStatus.NotAllowed, result.Status);
        Assert.Null(await RunAsync(services, s => s.GetParticipantAsync(Conn("x"))));
    }

    [Fact]
    public async Task Participant_uses_the_user_display_name()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();

        var result = await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana Maria"), channel));

        Assert.Equal("Ana Maria", result.Self!.Name);
    }

    [Fact]
    public async Task Join_fails_when_channel_is_full()
    {
        await using var services = db.CreateServices(maxParticipantsPerChannel: 1);
        var channel = await ChannelAsync();

        await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), channel));
        var result = await RunAsync(services, async s => await s.JoinAsync(Conn("b"), await UserAsync("Bia"), channel));

        Assert.Equal(JoinStatus.ChannelFull, result.Status);
        Assert.Null(await RunAsync(services, s => s.GetParticipantAsync(Conn("b"))));
    }

    [Fact]
    public async Task Same_connection_cannot_join_twice()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();
        var other = await OtherChannelAsync();

        await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), channel));
        var result = await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), other));

        Assert.Equal(JoinStatus.AlreadyInChannel, result.Status);
        Assert.Equal(channel, (await RunAsync(services, s => s.GetParticipantAsync(Conn("a"))))!.ChannelId);
    }

    [Fact]
    public async Task Leave_frees_a_slot_and_keeps_the_channel()
    {
        await using var services = db.CreateServices(maxParticipantsPerChannel: 1);
        var channel = await ChannelAsync();
        await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), channel));

        var left = await RunAsync(services, s => s.LeaveAsync(Conn("a")));
        var rejoin = await RunAsync(services, async s => await s.JoinAsync(Conn("b"), await UserAsync("Bia"), channel));

        Assert.Equal("Ana", left!.Participant.Name);
        Assert.False(left.WasStreaming);
        Assert.Equal(JoinStatus.Joined, rejoin.Status);
        Assert.Null(await RunAsync(services, s => s.LeaveAsync(Conn("a"))));
    }

    [Fact]
    public async Task SetMuted_updates_state_seen_by_new_participants()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();
        await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), channel));
        await RunAsync(services, s => s.SetMutedAsync(Conn("a"), true));

        var result = await RunAsync(services, async s => await s.JoinAsync(Conn("b"), await UserAsync("Bia"), channel));

        Assert.True(Assert.Single(result.ExistingParticipants).Muted);
        Assert.Null(await RunAsync(services, s => s.SetMutedAsync(Conn("ninguem"), true)));
    }

    [Fact]
    public async Task Concurrent_joins_never_exceed_capacity()
    {
        const int capacity = 6;
        await using var services = db.CreateServices(capacity);
        var channel = await ChannelAsync();

        var results = await Task.WhenAll(Enumerable.Range(0, 50).Select(i =>
            Task.Run(() => RunAsync(services, async s => await s.JoinAsync(Conn($"c{i}"), await UserAsync($"P{i}"), channel)))));

        Assert.Equal(capacity, results.Count(r => r.Status == JoinStatus.Joined));
    }

    [Fact]
    public async Task Concurrent_join_and_leave_keeps_channel_consistent()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();

        await Task.WhenAll(Enumerable.Range(0, 50).Select(i => Task.Run(async () =>
        {
            var id = Conn($"c{i}");
            var result = await RunAsync(services, async s => await s.JoinAsync(id, await UserAsync("P"), channel));
            if (result.Status == JoinStatus.Joined)
            {
                await RunAsync(services, s => s.LeaveAsync(id));
            }
        })));

        var last = await RunAsync(services, async s => await s.JoinAsync(Conn("final"), await UserAsync("F"), channel));
        Assert.Equal(JoinStatus.Joined, last.Status);
        Assert.Empty(last.ExistingParticipants);
    }

    [Fact]
    public async Task Stream_is_exclusive_per_channel_and_cleared_on_leave()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();
        await RunAsync(services, async s => await s.JoinAsync(Conn("a"), await UserAsync("Ana"), channel));
        await RunAsync(services, async s => await s.JoinAsync(Conn("b"), await UserAsync("Bia"), channel));

        Assert.Equal(StreamStartStatus.Started, (await RunAsync(services, s => s.StartStreamAsync(Conn("a")))).Status);
        var second = await RunAsync(services, s => s.StartStreamAsync(Conn("b")));
        Assert.Equal(StreamStartStatus.AlreadyStreaming, second.Status);
        Assert.Equal(Conn("a"), second.CurrentStreamer?.ConnectionId);

        var joined = await RunAsync(services, async s => await s.JoinAsync(Conn("c"), await UserAsync("Caio"), channel));
        Assert.Equal(Conn("a"), joined.Streamer?.ConnectionId);

        Assert.Null(await RunAsync(services, s => s.StopStreamAsync(Conn("b"))));
        Assert.True((await RunAsync(services, s => s.LeaveAsync(Conn("a"))))!.WasStreaming);
        Assert.Equal(StreamStartStatus.Started, (await RunAsync(services, s => s.StartStreamAsync(Conn("b")))).Status);
        Assert.Equal(StreamStartStatus.NotInChannel, (await RunAsync(services, s => s.StartStreamAsync(Conn("zz")))).Status);
    }

    [Fact]
    public async Task Concurrent_stream_starts_allow_only_one()
    {
        await using var services = db.CreateServices();
        var channel = await ChannelAsync();
        for (var i = 0; i < 6; i++)
        {
            var n = i;
            await RunAsync(services, async s => await s.JoinAsync(Conn($"p{n}"), await UserAsync($"P{n}"), channel));
        }

        var results = await Task.WhenAll(Enumerable.Range(0, 6)
            .Select(i => Task.Run(() => RunAsync(services, s => s.StartStreamAsync(Conn($"p{i}"))))));

        Assert.Single(results, r => r.Status == StreamStartStatus.Started);
    }

    private static async Task<T> RunAsync<T>(IServiceProvider services, Func<IVoiceSessionService, Task<T>> action)
    {
        await using var scope = services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IVoiceSessionService>());
    }
}
