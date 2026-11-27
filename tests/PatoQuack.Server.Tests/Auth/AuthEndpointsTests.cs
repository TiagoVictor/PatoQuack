using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PatoQuack.Server.Auth;
using PatoQuack.Server.Data;

namespace PatoQuack.Server.Tests.Auth;

/// <summary>Contas: primeiro acesso, convites, cadastro, confirmação, login, bloqueio e senha.</summary>
public sealed class AuthEndpointsTests(PatoQuackFactory factory) : IClassFixture<PatoQuackFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task First_access_creates_the_admin_once()
    {
        using var fresh = new PatoQuackFactory(); // banco vazio só para este teste
        using var client = fresh.CreateApiClient();

        var state = await client.GetFromJsonAsync<AuthStateDto>("/api/auth/state", Json);
        Assert.True(state!.SetupRequired);
        Assert.Null(state.User);

        var setup = await client.PostAsJsonAsync("/api/auth/setup", new { email = "admin@teste.local", displayName = "Admin", password = PatoQuackFactory.Password });
        Assert.Equal(HttpStatusCode.OK, setup.StatusCode);

        state = await client.GetFromJsonAsync<AuthStateDto>("/api/auth/state", Json);
        Assert.False(state!.SetupRequired);
        Assert.True(state.User!.IsAdmin);
        Assert.Equal("Admin", state.User.DisplayName);

        using var other = fresh.CreateApiClient();
        var again = await other.PostAsJsonAsync("/api/auth/setup", new { email = "x@teste.local", displayName = "Intruso", password = PatoQuackFactory.Password });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Invite_register_confirm_and_login()
    {
        using var inviter = await LoggedInAsync("Ana");
        var invite = await (await inviter.PostAsJsonAsync("/api/invites", new { room = "geral" })).Content.ReadFromJsonAsync<InviteDto>(Json);
        Assert.Contains("modo=cadastro", invite!.Url);
        Assert.Contains($"convite={invite.Code}", invite.Url);
        Assert.Equal("geral", invite.Room);

        using var anon = factory.CreateApiClient();
        var info = await anon.GetFromJsonAsync<InviteInfoDto>($"/api/invites/{invite.Code}", Json);
        Assert.True(info!.Valid);
        Assert.Equal("Ana", info.InviterName);
        Assert.False((await anon.GetFromJsonAsync<InviteInfoDto>("/api/invites/nao-existe", Json))!.Valid);

        var email = $"{Guid.NewGuid():N}@teste.local";
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(anon, "codigo-errado", email)).StatusCode);

        var registered = await Register(anon, invite.Code, email, "Bia");
        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(anon, invite.Code, $"{Guid.NewGuid():N}@teste.local")).StatusCode); // já usado

        // Antes de confirmar: senha certa, mas não entra.
        var early = await anon.PostAsJsonAsync("/api/auth/login", new { email, password = PatoQuackFactory.Password });
        Assert.Equal(HttpStatusCode.Forbidden, early.StatusCode);

        // Reenviar a confirmação mantém a sala do convite.
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/auth/resend-confirmation", new { email })).StatusCode);
        var link = await MailLinkAsync(email);
        Assert.Contains("modo=confirmar", link);
        Assert.Contains("sala=geral", link);
        var q = QueryHelpers.ParseQuery(new Uri(link).Query);
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.PostAsJsonAsync("/api/auth/confirm", new { userId = q["uid"].ToString(), token = "forjado" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsJsonAsync("/api/auth/confirm", new { userId = q["uid"].ToString(), token = q["token"].ToString() })).StatusCode);

        var login = await anon.PostAsJsonAsync("/api/auth/login", new { email, password = PatoQuackFactory.Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var state = await anon.GetFromJsonAsync<AuthStateDto>("/api/auth/state", Json);
        Assert.Equal("Bia", state!.User!.DisplayName);
        Assert.False(state.User.IsAdmin);

        Assert.Equal(HttpStatusCode.OK, (await anon.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Null((await anon.GetFromJsonAsync<AuthStateDto>("/api/auth/state", Json))!.User);
    }

    [Fact]
    public async Task Expired_invite_and_weak_password_are_rejected()
    {
        using var inviter = await LoggedInAsync("Ana");
        var invite = await (await inviter.PostAsJsonAsync("/api/invites", new { })).Content.ReadFromJsonAsync<InviteDto>(Json);
        using var anon = factory.CreateApiClient();

        // Senha fraca: recusa e o convite continua valendo.
        var weak = await anon.PostAsJsonAsync("/api/auth/register", new { invite = invite!.Code, email = $"{Guid.NewGuid():N}@teste.local", displayName = "Caio", password = "curta" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Contains("10 caracteres", (await weak.Content.ReadFromJsonAsync<ErrorDto>(Json))!.Error);
        Assert.True((await anon.GetFromJsonAsync<InviteInfoDto>($"/api/invites/{invite.Code}", Json))!.Valid);

        // Vencido.
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.SignupInvites.Where(i => i.Code == invite.Code)
                .ExecuteUpdateAsync(s => s.SetProperty(i => i.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        }

        Assert.False((await anon.GetFromJsonAsync<InviteInfoDto>($"/api/invites/{invite.Code}", Json))!.Valid);
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(anon, invite.Code, $"{Guid.NewGuid():N}@teste.local")).StatusCode);
    }

    [Fact]
    public async Task Five_wrong_passwords_lock_the_account()
    {
        var user = await factory.CreateUserAsync("Dani");
        using var client = factory.CreateApiClient();
        for (var i = 0; i < 5; i++)
        {
            var wrong = await client.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = "senha-errada-xx" });
            Assert.Equal(i < 4 ? HttpStatusCode.Unauthorized : HttpStatusCode.Locked, wrong.StatusCode);
        }

        // Bloqueada: nem a senha certa entra.
        var right = await client.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = PatoQuackFactory.Password });
        Assert.Equal(HttpStatusCode.Locked, right.StatusCode);

        // E-mail que não existe: mesma resposta de senha errada (não revela quem tem conta).
        var nobody = await client.PostAsJsonAsync("/api/auth/login", new { email = "ninguem@teste.local", password = "qualquer-coisa" });
        Assert.Equal(HttpStatusCode.Unauthorized, nobody.StatusCode);
    }

    [Fact]
    public async Task Forgot_and_reset_password_also_unlock()
    {
        var user = await factory.CreateUserAsync("Edu");
        using var client = factory.CreateApiClient();

        // Conta que não existe: responde OK do mesmo jeito e não manda e-mail.
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/forgot", new { email = "ninguem@teste.local" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/forgot", new { email = user.Email })).StatusCode);

        var link = await MailLinkAsync(user.Email!);
        Assert.Contains("modo=redefinir", link);
        var q = QueryHelpers.ParseQuery(new Uri(link).Query);
        const string newPassword = "uma-senha-nova-e-longa";
        var reset = await client.PostAsJsonAsync("/api/auth/reset", new { userId = q["uid"].ToString(), token = q["token"].ToString(), password = newPassword });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = PatoQuackFactory.Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = newPassword })).StatusCode);

        // O mesmo link não serve duas vezes.
        var again = await client.PostAsJsonAsync("/api/auth/reset", new { userId = q["uid"].ToString(), token = q["token"].ToString(), password = "outra-senha-longa-x" });
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
    }

    [Fact]
    public async Task Changes_require_the_csrf_header_and_invites_require_login()
    {
        var user = await factory.CreateUserAsync("Fê");
        using var plain = factory.CreateClient(); // sem o cabeçalho X-PatoQuack
        var forged = await plain.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = PatoQuackFactory.Password });
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);

        using var anon = factory.CreateApiClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsJsonAsync("/api/invites", new { })).StatusCode);
    }

    // ---- apoio ----------------------------------------------------------------

    private async Task<HttpClient> LoggedInAsync(string name)
    {
        var user = await factory.CreateUserAsync(name);
        var client = factory.CreateApiClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email = user.Email, password = PatoQuackFactory.Password });
        login.EnsureSuccessStatusCode();
        return client;
    }

    private static Task<HttpResponseMessage> Register(HttpClient client, string code, string email, string name = "Nova Pessoa") =>
        client.PostAsJsonAsync("/api/auth/register", new { invite = code, email, displayName = name, password = PatoQuackFactory.Password });

    /// <summary>Link do e-mail mais recente para o endereço (modo Pickup grava JSON na pasta).</summary>
    private async Task<string> MailLinkAsync(string to)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            if (Directory.Exists(factory.MailDirectory))
            {
                foreach (var file in Directory.GetFiles(factory.MailDirectory).OrderDescending())
                {
                    using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(file));
                    if (doc.RootElement.GetProperty("To").GetString() == to)
                    {
                        return doc.RootElement.GetProperty("Link").GetString()!;
                    }
                }
            }

            await Task.Delay(50);
        }

        throw new Xunit.Sdk.XunitException($"Nenhum e-mail para {to}");
    }
}
