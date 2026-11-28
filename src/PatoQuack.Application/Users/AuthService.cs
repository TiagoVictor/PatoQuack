using Microsoft.Extensions.Options;
using PatoQuack.Domain.Abstractions;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Users;

namespace PatoQuack.Application.Users;

public sealed class AuthService(
    IUserRepository users,
    IPasswordHasher passwordHasher,
    IUnitOfWork unitOfWork,
    IOptions<AuthOptions> options,
    TimeProvider timeProvider) : IAuthService
{
    public const int MinPasswordLength = 8;
    public const int MaxPasswordLength = 128;

    public async Task<RegisterResult> RegisterAsync(RegisterCommand command, CancellationToken cancellationToken = default)
    {
        if (DisplayName.Normalize(command.Name) is not { } name)
        {
            return new RegisterResult(RegisterStatus.InvalidName);
        }

        if (EmailAddress.Normalize(command.Email) is not { } email)
        {
            return new RegisterResult(RegisterStatus.InvalidEmail);
        }

        if (Username.Normalize(command.Username) is not { } username)
        {
            return new RegisterResult(RegisterStatus.InvalidUsername);
        }

        if (command.Password is not { Length: >= MinPasswordLength and <= MaxPasswordLength } password
            || string.IsNullOrWhiteSpace(password))
        {
            return new RegisterResult(RegisterStatus.WeakPassword);
        }

        // Checagens sem lock: dois cadastros simultâneos iguais esbarram no índice único.
        if (await users.EmailExistsAsync(email, cancellationToken))
        {
            return new RegisterResult(RegisterStatus.EmailTaken);
        }

        if (await users.UsernameExistsAsync(username, cancellationToken))
        {
            return new RegisterResult(RegisterStatus.UsernameTaken);
        }

        var now = timeProvider.GetUtcNow();
        var user = new User(Guid.CreateVersion7(now), name, email, username, passwordHasher.Hash(password), now);
        await users.AddAsync(user, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return new RegisterResult(RegisterStatus.Registered, user);
    }

    public async Task<LoginResult> LoginAsync(string? login, string? password, CancellationToken cancellationToken = default)
    {
        var invalid = new LoginResult(LoginStatus.Invalid);
        if (string.IsNullOrEmpty(password) || password.Length > MaxPasswordLength)
        {
            return invalid;
        }

        var user = (login ?? string.Empty).Contains('@', StringComparison.Ordinal)
            ? EmailAddress.Normalize(login) is { } email ? await users.GetByEmailAsync(email, cancellationToken) : null
            : Username.Normalize(login) is { } username ? await users.GetByUsernameAsync(username, cancellationToken) : null;

        if (user is null)
        {
            // Gasta o mesmo tempo de um hash para não revelar quais logins existem.
            passwordHasher.Hash(password);
            return invalid;
        }

        var now = timeProvider.GetUtcNow();
        if (user.IsLockedOut(now))
        {
            return new LoginResult(LoginStatus.LockedOut);
        }

        var verification = passwordHasher.Verify(user.PasswordHash, password);
        if (verification == PasswordVerification.Failed)
        {
            user.RegisterFailedLogin(now, options.Value.MaxFailedLogins, TimeSpan.FromMinutes(options.Value.LockoutMinutes));
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return user.IsLockedOut(now) ? new LoginResult(LoginStatus.LockedOut) : invalid;
        }

        if (verification == PasswordVerification.SuccessRehashNeeded)
        {
            user.UpdatePasswordHash(passwordHasher.Hash(password));
        }

        user.ResetFailedLogins();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new LoginResult(LoginStatus.Succeeded, user);
    }

    public Task<User?> GetUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        users.GetByIdAsync(userId, cancellationToken);
}
