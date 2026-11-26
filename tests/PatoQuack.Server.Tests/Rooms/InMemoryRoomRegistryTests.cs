using PatoQuack.Server.Rooms;

namespace PatoQuack.Server.Tests.Rooms;

public class InMemoryRoomRegistryTests
{
    private readonly InMemoryRoomRegistry _registry = new();

    [Fact]
    public async Task Join_returns_participants_already_in_room()
    {
        var first = await _registry.TryJoinAsync(new Participant("a", "Ana", "sala"), capacity: 6);
        var second = await _registry.TryJoinAsync(new Participant("b", "Bia", "sala"), capacity: 6);

        Assert.Equal(JoinStatus.Joined, first.Status);
        Assert.Empty(first.ExistingParticipants);
        Assert.Equal(JoinStatus.Joined, second.Status);
        Assert.Equal("a", Assert.Single(second.ExistingParticipants).ConnectionId);
    }

    [Fact]
    public async Task Rooms_are_isolated()
    {
        await _registry.TryJoinAsync(new Participant("a", "Ana", "sala-1"), 6);
        var other = await _registry.TryJoinAsync(new Participant("b", "Bia", "sala-2"), 6);

        Assert.Empty(other.ExistingParticipants);
    }

    [Fact]
    public async Task Join_fails_when_room_is_full()
    {
        await _registry.TryJoinAsync(new Participant("a", "Ana", "sala"), capacity: 1);
        var result = await _registry.TryJoinAsync(new Participant("b", "Bia", "sala"), capacity: 1);

        Assert.Equal(JoinStatus.RoomFull, result.Status);
        Assert.Null(await _registry.GetAsync("b"));
    }

    [Fact]
    public async Task Same_connection_cannot_join_twice()
    {
        await _registry.TryJoinAsync(new Participant("a", "Ana", "sala"), 6);
        var result = await _registry.TryJoinAsync(new Participant("a", "Ana", "outra"), 6);

        Assert.Equal(JoinStatus.AlreadyInRoom, result.Status);
        Assert.Equal("sala", (await _registry.GetAsync("a"))!.Room);
    }

    [Fact]
    public async Task Remove_frees_a_slot_and_returns_participant()
    {
        await _registry.TryJoinAsync(new Participant("a", "Ana", "sala"), capacity: 1);

        var removed = await _registry.RemoveAsync("a");
        var rejoin = await _registry.TryJoinAsync(new Participant("b", "Bia", "sala"), capacity: 1);

        Assert.Equal("Ana", removed!.Name);
        Assert.Equal(JoinStatus.Joined, rejoin.Status);
        Assert.Null(await _registry.RemoveAsync("a"));
    }

    [Fact]
    public async Task SetMuted_updates_state_seen_by_new_participants()
    {
        await _registry.TryJoinAsync(new Participant("a", "Ana", "sala"), 6);
        await _registry.SetMutedAsync("a", true);

        var result = await _registry.TryJoinAsync(new Participant("b", "Bia", "sala"), 6);

        Assert.True(Assert.Single(result.ExistingParticipants).Muted);
        Assert.Null(await _registry.SetMutedAsync("ninguem", true));
    }

    [Fact]
    public async Task Concurrent_joins_never_exceed_capacity()
    {
        const int capacity = 6;

        var results = await Task.WhenAll(Enumerable.Range(0, 200).Select(i =>
            Task.Run(() => _registry.TryJoinAsync(new Participant($"c{i}", $"P{i}", "sala"), capacity))));

        Assert.Equal(capacity, results.Count(r => r.Status == JoinStatus.Joined));
    }

    [Fact]
    public async Task Concurrent_join_and_leave_keeps_registry_consistent()
    {
        // Entra e sai repetidamente: exercita a remoção de salas vazias em paralelo com entradas.
        await Task.WhenAll(Enumerable.Range(0, 100).Select(i => Task.Run(async () =>
        {
            var id = $"c{i}";
            var result = await _registry.TryJoinAsync(new Participant(id, "P", "sala"), capacity: 6);
            if (result.Status == JoinStatus.Joined)
            {
                await _registry.RemoveAsync(id);
            }
        })));

        var last = await _registry.TryJoinAsync(new Participant("final", "F", "sala"), capacity: 6);
        Assert.Equal(JoinStatus.Joined, last.Status);
        Assert.Empty(last.ExistingParticipants);
    }
}
