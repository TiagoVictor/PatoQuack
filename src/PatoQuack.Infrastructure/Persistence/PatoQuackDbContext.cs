using Microsoft.EntityFrameworkCore;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Chat;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Servers;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence;

public sealed class PatoQuackDbContext(DbContextOptions<PatoQuackDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    public DbSet<Server> Servers => Set<Server>();

    public DbSet<ServerMember> ServerMembers => Set<ServerMember>();

    public DbSet<ServerInvite> ServerInvites => Set<ServerInvite>();

    public DbSet<VoiceChannel> VoiceChannels => Set<VoiceChannel>();

    public DbSet<Participant> Participants => Set<Participant>();

    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Cada entidade tem sua IEntityTypeConfiguration, ao lado do repositório dela.
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PatoQuackDbContext).Assembly);
    }
}
