using Microsoft.Data.Sqlite;
using PatoQuack.Server.Chat;

namespace PatoQuack.Server.Tests.Chat;

public sealed class SqliteChatStoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"patoquack-store-{Guid.NewGuid():N}.db");
    private static readonly DateTimeOffset T0 = new(2026, 11, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Messages_come_back_in_order_per_room_and_survive_a_restart()
    {
        var store = new SqliteChatStore(_path);
        var a1 = await store.AddAsync("sala", "Ana", "primeira", T0);
        await store.AddAsync("outra", "Bia", "de outra sala", T0.AddSeconds(1));
        var a2 = await store.AddAsync("sala", "Caio", "segunda\ncom quebra", T0.AddSeconds(2));

        Assert.True(a2.Id > a1.Id);
        // Uma instância nova (servidor reiniciado) lê o mesmo arquivo.
        var reopened = new SqliteChatStore(_path);
        var messages = await reopened.GetRecentAsync("sala", 10);
        Assert.Equal(["primeira", "segunda\ncom quebra"], messages.Select(m => m.Text));
        Assert.Equal(["Ana", "Caio"], messages.Select(m => m.AuthorName));
        Assert.Equal(T0.AddSeconds(2), messages[1].SentAt);
    }

    [Fact]
    public async Task Paging_returns_the_most_recent_before_an_id()
    {
        var store = new SqliteChatStore(_path);
        var ids = new List<long>();
        for (var i = 1; i <= 5; i++)
        {
            ids.Add((await store.AddAsync("sala", "Ana", $"m{i}", T0.AddSeconds(i))).Id);
        }

        Assert.Equal(["m4", "m5"], (await store.GetRecentAsync("sala", 2)).Select(m => m.Text));
        Assert.Equal(["m2", "m3"], (await store.GetRecentAsync("sala", 2, ids[3])).Select(m => m.Text));
        Assert.Empty(await store.GetRecentAsync("sala", 2, ids[0]));
    }

    [Fact]
    public async Task Retention_deletes_only_older_messages()
    {
        var store = new SqliteChatStore(_path);
        await store.AddAsync("sala", "Ana", "velha", T0.AddDays(-31));
        await store.AddAsync("sala", "Ana", "nova", T0.AddDays(-1));

        Assert.Equal(1, await store.DeleteOlderThanAsync(T0.AddDays(-30)));
        Assert.Equal(["nova"], (await store.GetRecentAsync("sala", 10)).Select(m => m.Text));
    }

    [Fact]
    public async Task Text_is_stored_as_data_not_sql()
    {
        var store = new SqliteChatStore(_path);
        const string tricky = "'); DROP TABLE chat_messages; -- <script>alert(1)</script>";
        await store.AddAsync("sala", "Ana", tricky, T0);
        Assert.Equal([tricky], (await store.GetRecentAsync("sala", 10)).Select(m => m.Text));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            File.Delete(_path + suffix);
        }
    }
}
