using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Chat;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence.Chat;

internal sealed class ChatMessageConfiguration : IEntityTypeConfiguration<ChatMessage>
{
    public const string Table = "chat_messages";

    public void Configure(EntityTypeBuilder<ChatMessage> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(m => m.Id);

        builder.Property(m => m.Id)
            .HasColumnName("id")
            .UseIdentityAlwaysColumn();

        builder.Property(m => m.ChannelId).HasColumnName("channel_id").IsRequired();
        builder.Property(m => m.AuthorId).HasColumnName("author_id").IsRequired();

        builder.Property(m => m.AuthorName)
            .HasColumnName("author_name")
            .HasMaxLength(DisplayName.MaxLength)
            .IsRequired();

        // O limite de tamanho é regra da aplicação (configurável); a coluna não corta texto.
        builder.Property(m => m.Text)
            .HasColumnName("text")
            .IsRequired();

        builder.Property(m => m.SentAt).HasColumnName("sent_at").IsRequired();

        // Histórico: as mais recentes do canal, paginando por Id.
        builder.HasIndex(m => new { m.ChannelId, m.Id });
        // Retenção: apagar por data.
        builder.HasIndex(m => m.SentAt);

        // Apagar o canal (ou o servidor) apaga as mensagens dele.
        builder.HasOne<VoiceChannel>()
            .WithMany()
            .HasForeignKey(m => m.ChannelId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(m => m.AuthorId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
