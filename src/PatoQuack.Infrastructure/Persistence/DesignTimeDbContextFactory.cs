using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PatoQuack.Infrastructure.Persistence;

/// <summary>
/// Usado só pelo <c>dotnet ef</c> (migrations). Lê a connection string da variável
/// <c>ConnectionStrings__PatoQuack</c> ou usa o Postgres local do docker-compose.
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<PatoQuackDbContext>
{
    public PatoQuackDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__PatoQuack")
            ?? "Host=localhost;Port=5432;Database=patoquack;Username=patoquack;Password=patoquack";

        var options = new DbContextOptionsBuilder<PatoQuackDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        return new PatoQuackDbContext(options);
    }
}
