using Microsoft.Data.Sqlite;

namespace PatoQuack.Server.Chat;

/// <summary>
/// Mensagens num arquivo SQLite. Uma conexão por operação (o Microsoft.Data.Sqlite reaproveita do
/// pool). Modo WAL: leituras não bloqueiam a escrita. Serve para uma instância do servidor, que é
/// o caso hoje (o registro de salas também é em memória).
/// </summary>
public sealed class SqliteChatStore : IChatStore
{
    private const int SchemaVersion = 1;
    private readonly string _connectionString;

    public SqliteChatStore(string databasePath)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(databasePath));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
        }.ToString();

        Initialize();
    }

    private void Initialize()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"""
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS chat_messages (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                room    TEXT    NOT NULL,
                author  TEXT    NOT NULL,
                text    TEXT    NOT NULL,
                sent_at INTEGER NOT NULL  -- Unix ms (UTC)
            );
            CREATE INDEX IF NOT EXISTS ix_chat_messages_room_id ON chat_messages (room, id);
            CREATE INDEX IF NOT EXISTS ix_chat_messages_sent_at ON chat_messages (sent_at);
            PRAGMA user_version = {SchemaVersion};
            """;
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    public async Task<StoredChatMessage> AddAsync(string room, string authorName, string text, DateTimeOffset sentAt)
    {
        await using var connection = Open();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO chat_messages (room, author, text, sent_at) VALUES ($room, $author, $text, $sentAt);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("$room", room);
        command.Parameters.AddWithValue("$author", authorName);
        command.Parameters.AddWithValue("$text", text);
        command.Parameters.AddWithValue("$sentAt", sentAt.ToUnixTimeMilliseconds());
        var id = (long)(await command.ExecuteScalarAsync())!;
        return new StoredChatMessage(id, room, authorName, text, DateTimeOffset.FromUnixTimeMilliseconds(sentAt.ToUnixTimeMilliseconds()));
    }

    public async Task<IReadOnlyList<StoredChatMessage>> GetRecentAsync(string room, int limit, long? beforeId = null)
    {
        await using var connection = Open();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, author, text, sent_at FROM chat_messages
            WHERE room = $room AND ($before IS NULL OR id < $before)
            ORDER BY id DESC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$room", room);
        command.Parameters.AddWithValue("$before", (object?)beforeId ?? DBNull.Value);
        command.Parameters.AddWithValue("$limit", limit);

        var messages = new List<StoredChatMessage>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            messages.Add(new StoredChatMessage(
                reader.GetInt64(0), room, reader.GetString(1), reader.GetString(2),
                DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(3))));
        }

        messages.Reverse(); // a consulta vem da mais nova para a mais antiga
        return messages;
    }

    public async Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff)
    {
        await using var connection = Open();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM chat_messages WHERE sent_at < $cutoff;";
        command.Parameters.AddWithValue("$cutoff", cutoff.ToUnixTimeMilliseconds());
        return await command.ExecuteNonQueryAsync();
    }
}
