import { Document, Packer, Paragraph } from 'docx'

const toParagraphs = (text) => {
  const normalized = (text || '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (!lines.length) {
    return [new Paragraph('')]
  }
  return lines.map((line) => new Paragraph(line || ''))
}

export const buildSummaryDocxFile = async ({ filename, content }) => {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: toParagraphs(content),
      },
    ],
  })
  const blob = await Packer.toBlob(doc)
  return new File([blob], filename, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
