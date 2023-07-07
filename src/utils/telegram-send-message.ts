import Axios from 'axios';

export function sendMessage(
  chatId: string,
  token: string,
  markdownText: string
) {
  return Axios.get(`https://api.telegram.org/bot${token}/sendMessage`, {
    params: {
      chat_id: chatId,
      text: markdownText,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    }
  });
}
