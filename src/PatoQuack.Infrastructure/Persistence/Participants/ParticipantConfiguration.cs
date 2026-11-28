using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Participants;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence.Participants;

internal sealed class ParticipantConfiguration : IEntityTypeConfiguration<Participant>
{
    public const string Table = "participants";

    public static class Columns
    {
        public const string ConnectionId = "connection_id";
        public const string Name = "name";
        public const string ChannelId = "channel_id";
        public const string UserId = "user_id";
        public const string Muted = "muted";
        public const string JoinedAt = "joined_at";
    }

    public void Configure(EntityTypeBuilder<Participant> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(p => p.ConnectionId);

        builder.Property(p => p.ConnectionId)
            .HasColumnName(Columns.ConnectionId)
            .HasMaxLength(Participant.MaxConnectionIdLength)
            .ValueGeneratedNever();

        builder.Property(p => p.Name)
            .HasColumnName(Columns.Name)
            .HasMaxLength(DisplayName.MaxLength)
            .IsRequired();

        builder.Property(p => p.ChannelId)
            .HasColumnName(Columns.ChannelId)
            .IsRequired();

        builder.Property(p => p.UserId)
            .HasColumnName(Columns.UserId)
            .IsRequired();

        builder.Property(p => p.Muted)
            .HasColumnName(Columns.Muted)
            .IsRequired();

        builder.Property(p => p.JoinedAt)
            .HasColumnName(Columns.JoinedAt)
            .IsRequired();

        // Listar o canal em ordem de entrada.
        builder.HasIndex(p => new { p.ChannelId, p.JoinedAt });

        // Apagar o canal apaga a presença nele.
        builder.HasOne<VoiceChannel>()
            .WithMany()
            .HasForeignKey(p => p.ChannelId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(p => p.UserId);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
