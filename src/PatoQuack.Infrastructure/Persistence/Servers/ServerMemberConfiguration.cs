using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Servers;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence.Servers;

internal sealed class ServerMemberConfiguration : IEntityTypeConfiguration<ServerMember>
{
    public const string Table = "server_members";

    public void Configure(EntityTypeBuilder<ServerMember> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(m => new { m.ServerId, m.UserId });

        builder.Property(m => m.ServerId).HasColumnName("server_id");
        builder.Property(m => m.UserId).HasColumnName("user_id");
        builder.Property(m => m.JoinedAt).HasColumnName("joined_at").IsRequired();

        // "Meus servidores" busca por usuário.
        builder.HasIndex(m => m.UserId);

        builder.HasOne<Server>()
            .WithMany()
            .HasForeignKey(m => m.ServerId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
