import * as fs from 'fs';
import * as path from 'path';

type Conversation = {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, MappingNode>;
  current_node: string;
};

type MappingNode = {
  id: string;
  parent: string | null;
  children: string[];
  message: Message | null;
};

type Message = {
  id: string;
  author: {
    role: 'user' | 'assistant' | 'system';
  };
  create_time: number;
  content: {
    content_type: string;
    parts: string[];
  };
};

type MetaData = {
  filePath: string;
  latestMessageId: string;
};

type ConversationExportPayload = {
  content: string;
  latestMessageId: string;
};

const dir = process.argv[2];
if (!dir) {
  console.log('ログを保存するディレクトリを指定してください\n');
  console.log('Usage: node GPTLogsToMd.ts directory_full_path\n');
}

let mdFiles;
try {
  mdFiles = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .filter((d) => path.extname(d.name) === '.md')
    .map((d) => path.join(dir, d.name));
} catch (e) {
  console.error('\x1b[31mError\x1b[39m: 指定されたディレクトリが存在しない可能性があります\n');
  console.error(e);
  process.exit(1);
}

function mappingMetadata(): Map<string, MetaData> {
  const mdMap = new Map<string, MetaData>();
  let i = 0;
  while (mdFiles[i]) {
    const filePath = mdFiles[i];
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(1024);
    fs.readSync(fd, buffer, 0, 1024, null);
    fs.closeSync(fd);
    const head = buffer.toString('utf-8');
    const conversationId = /conversation_id:\s*(.+)/.exec(head)?.[1];
    const latestMessageId = /latest_message_id:\s*(.+)/.exec(head)?.[1];
    const metaData: MetaData = {
      filePath: filePath,
      latestMessageId: latestMessageId,
    };
    mdMap.set(conversationId, metaData);
    i++;
  }
  return mdMap;
}

const mdMap: Map<string, MetaData> = mappingMetadata();
let raw;
try {
  raw = fs.readFileSync('conversations.json', 'utf-8');
} catch (e) {
  console.error('\x1b[31mError\x1b[39m: conversations.jsonが存在しません\n');
  console.error(e);
  process.exit(1);
}
const conversations: Conversation[] = JSON.parse(raw);

function formatCreateTimeUTC(createTime: number): string {
  const date = new Date(createTime * 1000);
  const yyyy = date.getUTCFullYear();
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');

  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

function extractLinearMessages(conv: Conversation): Message[] {
  const result: Message[] = [];

  let nodeId = conv.current_node;
  let afterLatestId = true;
  let latestMessageId = mdMap.get(conv.id)?.latestMessageId;

  while (nodeId) {
    const node = conv.mapping[nodeId];
    if (!node) {
      break;
    }
    if (node.message && node.message.id === latestMessageId) {
      afterLatestId = false;
    }
    if (node.message && afterLatestId) {
      result.push(node.message);
    }
    nodeId = node.parent ?? '';
  }

  return result.reverse();
}

function updateLatestMessageId(content: string, newId: string): string {
  const pattern = /^latest_message_id:\s*.*$/m;

  if (pattern.test(content)) {
    return content.replace(pattern, `latest_message_id: ${newId}`);
  } else {
    return content.replace(/^<!--META\n/, `<!--META\nlatest_message_id: ${newId}\n`);
  }
}

function formatteContents(conversation: Conversation): ConversationExportPayload {
  const messages = extractLinearMessages(conversation);
  let data = '';
  let currentLatestMessageId = mdMap.get(conversation.id)?.latestMessageId;
  for (const m of messages) {
    if (m.author.role !== 'assistant' && m.author.role !== 'user') {
      continue;
    }
    if (!m.content.parts || m.content.parts.join('') === '') {
      continue;
    }
    data +=
      `[${formatCreateTimeUTC(m.create_time)}]` +
      '\n' +
      `[${m.author.role === 'assistant' ? 'ChatGPT' : m.author.role === 'user' ? 'あなた' : m.author.role}]` +
      '\n' +
      m.content.parts?.join('') +
      '\n\n\n';
    currentLatestMessageId = m.id;
  }
  if (!mdMap.has(conversation.id)) {
    const metaData =
      '<!--META' +
      '\n' +
      'conversation_id: ' +
      conversation.id +
      '\n' +
      'latest_message_id: ' +
      currentLatestMessageId +
      '\n' +
      'create_time: ' +
      formatCreateTimeUTC(conversation.create_time) +
      '\n' +
      'title: ' +
      conversation.title +
      '\n' +
      'META-->' +
      '\n';
    data = metaData + data;
  } else {
    const existingData = fs.readFileSync(mdMap.get(conversation.id)?.filePath, 'utf-8');
    const existingDataMetaUpdated = updateLatestMessageId(existingData, currentLatestMessageId);
    data = existingDataMetaUpdated + data;
  }
  const payload: ConversationExportPayload = {
    content: data,
    latestMessageId: currentLatestMessageId,
  };
  return payload;
}

function sanitizeFileName(title: string): string {
  let fileName = title
    .replace(/[/\\:?*"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .trim();
  if (fileName.length > 128) {
    fileName = fileName.slice(0, 128) + '...';
  }
  return fileName;
}

function writeTmpFileAndRename(filePath: string, content: string) {
  let tmpFileName;
  let fd;
  try {
    tmpFileName = `./tmp_${Math.random().toString(36).slice(2, 12)}`;
    fd = fs.openSync(tmpFileName, 'w');
  } catch (e) {
    console.error('\x1b[31mError\x1b[39m: ファイルを開くのに失敗しました\n');
    console.error(e);
    process.exit(1);
  }
  fs.writeSync(fd, content, 0);
  fs.closeSync(fd);
  fs.renameSync(tmpFileName, filePath);
}

function writeMdFile() {
  let i = 0;
  while (conversations[i]) {
    const exportPaylad = formatteContents(conversations[i]);
    let filePath;
    const exist = mdMap.has(conversations[i].id);
    if (exist) {
      filePath = mdMap.get(conversations[i].id).filePath;
    } else {
      const fileName = sanitizeFileName(conversations[i].title);
      filePath =
        dir + '/' + formatCreateTimeUTC(conversations[i].create_time) + ' ' + fileName + '.md';
    }
    if (exist && exportPaylad.latestMessageId !== mdMap.get(conversations[i].id).latestMessageId) {
      writeTmpFileAndRename(filePath, exportPaylad.content);
      console.log('\x1b[32mSuccess\x1b[39m: ' + filePath + 'を更新しました');
    } else if (!exist && exportPaylad.content && exportPaylad.content !== '') {
      writeTmpFileAndRename(filePath, exportPaylad.content);
      console.log('\x1b[32mSuccess\x1b[39m: ' + filePath + 'を作成しました');
    } else {
      console.log('Unchanged: \x1b[90m' + filePath + '\x1b[39m');
    }
    i++;
  }
  console.log('\n\x1b[32mComplete\x1b[39m!');
  console.log('全ての会話ログの作成・更新が完了しました');
}

writeMdFile();
