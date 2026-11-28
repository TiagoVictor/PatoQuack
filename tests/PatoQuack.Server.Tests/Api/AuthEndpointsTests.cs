using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using PatoQuack.Server.Api;
using PatoQuack.Server.Tests.Infrastructure;

namespace PatoQuack.Server.Tests.Api;

[Collection(PostgresCollection.Name)]
public sealed class AuthEndpointsTests(PostgresFixture db)
{
    private HttpClient NewClient() => db.CreateApiClient();

    [Fact]
    public async Task Register_signs_in_and_logout_ends_the_session()
    {
        var session = await db.RegisterSessionAsync("Tiago");

        var me = await session.Client.GetFromJsonAsync<UserDto>("/api/auth/me");
        Assert.Equal(session.User, me);

        await session.Client.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.Client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Login_with_username_or_email()
    {
        var session = await db.RegisterSessionAsync("Tiago");

        foreach (var login in new[] { session.User.Username, session.User.Email.ToUpperInvariant() })
        {
            var client = NewClient();
            var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(login, PostgresFixture.Password));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(session.User.Id, (await client.GetFromJsonAsync<UserDto>("/api/auth/me"))!.Id);
        }

        var wrong = await NewClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(session.User.Username, "senha-errada"));
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Contains("incorretos", (await wrong.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
    }

    [Fact]
    public async Task Register_validates_and_rejects_duplicates()
    {
        var session = await db.RegisterSessionAsync();
        var client = NewClient();

        var duplicate = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("Outro", session.User.Email, "outro_nome", PostgresFixture.Password));
        var weak = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("Outro", "novo@teste.dev", "outro_nome", "123"));

        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Contains("senha", (await weak.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
    }

    [Fact]
    public async Task Session_cookie_is_http_only()
    {
        var client = db.CreateApiClient(handleCookies: false);
        var handle = $"c{Guid.NewGuid():N}"[..16];
        var response = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("Teste", $"{handle}@teste.dev", handle, PostgresFixture.Password));

        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("pq.session=", StringComparison.Ordinal));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task State_changing_calls_without_the_security_header_are_refused()
    {
        var session = await db.RegisterSessionAsync();
        var client = db.Factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(session.User.Username, PostgresFixture.Password));
        var create = new HttpRequestMessage(HttpMethod.Post, "/api/servers") { Content = JsonContent.Create(new NameRequest("x")) };
        create.Headers.Add("Cookie", session.Cookie);
        var created = await client.SendAsync(create);

        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, created.StatusCode);
        Assert.Contains("segurança", (await created.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
    }

    [Fact]
    public async Task Too_many_wrong_passwords_return_429()
    {
        var session = await db.RegisterSessionAsync();
        var client = NewClient();
        for (var i = 0; i < 4; i++)
        {
            await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(session.User.Username, "errada"));
        }

        var locked = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(session.User.Username, "errada"));

        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        Assert.Contains("Espere", (await locked.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
    }

    [Fact]
    public async Task Protected_endpoints_require_login()
    {
        var client = NewClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/servers")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/servers", new NameRequest("x"))).StatusCode);
    }
}
