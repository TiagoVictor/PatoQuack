using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Application.Users;
using PatoQuack.Server.Tests.Infrastructure;

namespace PatoQuack.Server.Tests.Users;

[Collection(PostgresCollection.Name)]
public sealed class AuthServiceTests(PostgresFixture db)
{
    private readonly string _handle = $"a{Guid.NewGuid():N}"[..16];

    [Fact]
    public async Task Register_normalizes_and_login_accepts_email_or_username()
    {
        await using var services = db.CreateServices();

        var result = await RunAsync(services, s => s.RegisterAsync(
            new RegisterCommand("  Tiago ", $" {_handle.ToUpperInvariant()}@Teste.DEV ", $"@{_handle.ToUpperInvariant()}", "senha-forte")));

        Assert.Equal(RegisterStatus.Registered, result.Status);
        var user = result.User!;
        Assert.Equal("Tiago", user.Name);
        Assert.Equal($"{_handle}@teste.dev", user.Email);
        Assert.Equal(_handle, user.Username);
        Assert.DoesNotContain("senha-forte", user.PasswordHash);

        Assert.Equal(user.Id, (await RunAsync(services, s => s.LoginAsync($"{_handle}@TESTE.dev", "senha-forte"))).User?.Id);
        Assert.Equal(user.Id, (await RunAsync(services, s => s.LoginAsync(_handle.ToUpperInvariant(), "senha-forte"))).User?.Id);
        Assert.Equal(LoginStatus.Invalid, (await RunAsync(services, s => s.LoginAsync(_handle, "senha-errada"))).Status);
        Assert.Equal(LoginStatus.Invalid, (await RunAsync(services, s => s.LoginAsync("ninguem-aqui", "senha-forte"))).Status);
    }

    [Fact]
    public async Task Register_rejects_duplicates_and_invalid_data()
    {
        await using var services = db.CreateServices();
        await RunAsync(services, s => s.RegisterAsync(new RegisterCommand("A", $"{_handle}@teste.dev", _handle, "senha-forte")));

        Assert.Equal(RegisterStatus.EmailTaken, (await Register(services, "B", $"{_handle}@TESTE.dev", _handle + "x", "senha-forte")).Status);
        Assert.Equal(RegisterStatus.UsernameTaken, (await Register(services, "B", $"x{_handle}@teste.dev", _handle, "senha-forte")).Status);
        Assert.Equal(RegisterStatus.InvalidName, (await Register(services, " ", "n@teste.dev", "nome_ok", "senha-forte")).Status);
        Assert.Equal(RegisterStatus.InvalidEmail, (await Register(services, "B", "sem-arroba", "nome_ok", "senha-forte")).Status);
        Assert.Equal(RegisterStatus.InvalidUsername, (await Register(services, "B", "n@teste.dev", "a b", "senha-forte")).Status);
        Assert.Equal(RegisterStatus.InvalidUsername, (await Register(services, "B", "n@teste.dev", "ab", "senha-forte")).Status);
        Assert.Equal(RegisterStatus.WeakPassword, (await Register(services, "B", "n@teste.dev", "nome_ok", "curta")).Status);
    }

    [Fact]
    public async Task Five_wrong_passwords_lock_the_login_even_with_the_right_one()
    {
        await using var services = db.CreateServices();
        await RunAsync(services, s => s.RegisterAsync(new RegisterCommand("A", $"{_handle}@teste.dev", _handle, "senha-forte")));

        // Erros intercalados com um acerto não acumulam (o acerto zera a contagem).
        for (var i = 0; i < 4; i++) await RunAsync(services, s => s.LoginAsync(_handle, "errada"));
        Assert.Equal(LoginStatus.Succeeded, (await RunAsync(services, s => s.LoginAsync(_handle, "senha-forte"))).Status);

        for (var i = 0; i < 4; i++)
        {
            Assert.Equal(LoginStatus.Invalid, (await RunAsync(services, s => s.LoginAsync(_handle, "errada"))).Status);
        }

        Assert.Equal(LoginStatus.LockedOut, (await RunAsync(services, s => s.LoginAsync(_handle, "errada"))).Status);
        Assert.Equal(LoginStatus.LockedOut, (await RunAsync(services, s => s.LoginAsync(_handle, "senha-forte"))).Status);
    }

    private static Task<RegisterResult> Register(IServiceProvider services, string name, string email, string username, string password) =>
        RunAsync(services, s => s.RegisterAsync(new RegisterCommand(name, email, username, password)));

    private static async Task<T> RunAsync<T>(IServiceProvider services, Func<IAuthService, Task<T>> action)
    {
        await using var scope = services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<IAuthService>());
    }
}
