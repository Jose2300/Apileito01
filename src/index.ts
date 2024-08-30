import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import sharp from 'sharp';
import path from 'path';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from "@google/generative-ai/server";

dotenv.config({ path: './arquivo.env' });

const app = express();
const port = 3000;

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Função auxiliar para formatar respostas de erro
function formatErrorResponse(description: string) {
  return {
    error_code: 'INVALID_DATA',
    error_description: description,
  };
}

// Simulação de banco de dados na memória com o campo has_confirmed
interface Measure {
  measure_uuid: string;
  customer_code: string;
  measure_datetime: string; // Formato de string ISO para data e hora
  measure_type: string;
  filePath: string;
  measure_value?: number; // Opcional, para armazenar valor gerado pela IA
  has_confirmed: boolean; // Novo campo para rastrear o status de confirmação
}

let database: Measure[] = [
  // Adicione mais medições conforme necessário
];


// Função auxiliar para validar `measure_datetime`
function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

// Função auxiliar para garantir que o diretório exista
async function ensureDirectoryExists(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error(`Erro ao criar o diretório ${dir}:`, err);
  }
}

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY não está definida nas variáveis de ambiente.');
}

const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);
// Função para processar e descrever a imagem usando a IA
async function processAndDescribeImage(filePath: string): Promise<number | null> {
  
  try {
   

    // Obter o MIME type do arquivo
    const mimeType = getMimeType(filePath);
    

    // Fazer o upload do arquivo
    const uploadResponse = await fileManager.uploadFile(filePath, {
      mimeType: mimeType,
      displayName: "contador",
    });
    // Get the previously uploaded file's metadata.
const getResponse = await fileManager.getFile(uploadResponse.file.name);

// View the response.
console.log(`Retrieved file ${getResponse.displayName} as ${getResponse.uri}`);

    // Obter o modelo de IA
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    // Gerar o conteúdo com base no arquivo carregado
    const result = await model.generateContent([
      {
        fileData: {
          mimeType: uploadResponse.file.mimeType,
          fileUri: uploadResponse.file.uri
        }
      },
      { text: "Descreva o número do contador apenas" },
    ]);

    // Processar a resposta
    console.log(result.response.text);
    
    // Aqui você pode precisar de um ajuste dependendo do formato da resposta
    const measureValue = parseFloat(result.response.text());

    return isNaN(measureValue) ? null : measureValue;
  } catch (err) {
    console.error('Erro ao processar e descrever a imagem:', err);
    return null;
  }
}

// Função para obter o MIME type do arquivo
function getMimeType(filePath: string): string {
  const extname = path.extname(filePath).toLowerCase();
  switch (extname) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream'; // Tipo padrão para arquivos desconhecidos
  }
}

// Função para validar a imagem base64
function isBase64Image(image: string): boolean {
  // Expressão regular para validar base64 com os tipos de imagem permitidos
  const base64ImageRegex = /^data:image\/(jpeg|png|webp|heic|heif);base64,/;

  let base64Data = image;

  // Verifica se a string começa com o prefixo e remove o prefixo se estiver presente
  if (base64ImageRegex.test(image)) {
      base64Data = image.replace(base64ImageRegex, '');
  }

  // Verifica se o comprimento do base64Data é um múltiplo de 4
  if (base64Data.length % 4 !== 0) {
      return false;
  }

  // Verifica se a string base64Data contém apenas caracteres válidos
  const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Pattern.test(base64Data)) {
      return false;
  }

  // Tenta decodificar a string base64Data
  try {
      atob(base64Data);
      return true;
  } catch (e) {
      return false;
  }
}

// Função de validação consolidada
function validateUploadRequest(image: string, customer_code: string, measure_datetime: string, measure_type: string) {
  if (typeof customer_code !== 'string') {
    return formatErrorResponse('Código do cliente inválido. Esperado uma string.');
  }

  if (!isValidDate(measure_datetime)) {
    return formatErrorResponse('Data e hora da medição inválidas. Esperado uma string de data válida.');
  }

  const validMeasureTypes = ['WATER', 'GAS'];
  if (typeof measure_type !== 'string' || !validMeasureTypes.includes(measure_type.toUpperCase())) {
    return formatErrorResponse('Tipo de medição inválido. Esperado "WATER" ou "GAS".');
  }

  if (!image || !isBase64Image(image)) {
    return formatErrorResponse('Dados da imagem inválidos. Certifique-se de que a imagem esteja codificada em Base64');
  }

  return null; // Sem erros
}

// Endpoint POST para fazer o upload de uma imagem
app.post('/upload', async (req: Request, res: Response) => {
  const { image, customer_code, measure_datetime, measure_type } = req.body;

  // Validação consolidada
  const validationError = validateUploadRequest(image, customer_code, measure_datetime, measure_type);
  if (validationError) {
    return res.status(400).json(validationError);
  }

  // Decodificar a imagem Base64
  const base64Data = image.replace(/^data:image\/jpeg;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // Gerar um nome de arquivo único
  const filename = `${Date.now()}.jpg`;
  const filePath = path.join(__dirname, 'tmp', filename);

  // Garantir que o diretório exista
  await ensureDirectoryExists(path.dirname(filePath));

  // Verificar se já existe uma medida com a mesma data e hora
  const existingMeasure = database.find(measure => measure.measure_datetime === measure_datetime);

  if (existingMeasure) {
    if (existingMeasure.measure_type === measure_type) {
      return res.status(409).json({
        error_code: 'DOUBLE_REPORT',
        error_description: 'Leitura do mês já realizada para o mesmo tipo',
      });
    }
  }

  try {
    // Use sharp para processar e salvar a imagem
    await sharp(buffer).toFile(filePath);

    // Obter o valor gerado pela IA
    const measureValue = await processAndDescribeImage(filePath);

    if (measureValue === null) {
      return res.status(500).json({
        error_code: 'INTERNAL_ERROR',
        error_description: 'Falha ao recuperar o valor da medição da IA',
      });
    }

    // Salvar os dados no banco de dados na memória
    const newMeasure: Measure = {
      measure_uuid: `${Date.now()}`, // Gere um UUID único ou use uma biblioteca real de UUID
      customer_code,
      measure_datetime,
      measure_type,
      filePath,
      measure_value: measureValue,
      has_confirmed: false, // Inicialize has_confirmed como false
    };
    database.push(newMeasure);

    // Responder com sucesso após a imagem ser salva
    res.status(200).json({ 
      image_url: filePath, 
      measure_value: measureValue, 
      measure_uuid: newMeasure.measure_uuid 
    });
  } catch (err) {
    console.error('Erro ao salvar a imagem:', err);
    res.status(500).json({
      error_code: 'INTERNAL_ERROR',
      error_description: 'Falha ao salvar a imagem',
    });
  } finally {
    // Excluir o arquivo de imagem
    try {
      await fs.unlink(filePath);
      console.log(`Arquivo excluído: ${filePath}`);
    } catch (err) {
      console.error('Erro ao excluir o arquivo de imagem:', err);
    }
  }
});

// Endpoint PATCH para confirmar uma medição
app.patch('/confirm', async (req: Request, res: Response) => {
  const { measure_uuid, confirmed_value } = req.body;

  // Validação consolidada
  if (typeof measure_uuid !== 'string' || typeof confirmed_value !== 'number') {
    return res.status(400).json({
      error_code: 'INVALID_DATA',
      error_description: 'Tipos de entrada inválidos. Esperado measure_uuid como uma string e confirmed_value como um número.',
    });
  }

  try {
    // Encontrar a medição no banco de dados na memória
    const measure = database.find(measure => measure.measure_uuid === measure_uuid);

    // Verificar se a medição existe
    if (!measure) {
      return res.status(404).json({
        error_code: 'MEASURE_NOT_FOUND',
        error_description: 'Medição não encontrada.',
      });
    }

    // Verificar se a medição já foi confirmada
    if (measure.has_confirmed) {
      return res.status(409).json({
        error_code: 'CONFIRMATION_DUPLICATE',
        error_description: 'Medição já confirmada.',
      });
    }

    // Atualizar a medição com o novo valor confirmado e definir has_confirmed como true
    measure.measure_value = confirmed_value;
    measure.has_confirmed = true;

    // Responder com sucesso
    res.status(200).json({ 
      success: true, 
    });
  } catch (err) {
    console.error('Erro ao atualizar a medição:', err);
    res.status(500).json({
      error_code: 'INTERNAL_ERROR',
      error_description: 'Falha ao atualizar a medição.',
    });
  }
});

app.get('/:customer_code/list', (req: Request, res: Response) => {
  const { customer_code } = req.params;
  const { measure_type } = req.query;

  // Validar o parâmetro de consulta measure_type
  const validMeasureTypes = ['WATER', 'GAS'];
  if (measure_type && typeof measure_type === 'string') {
    const normalizedMeasureType = measure_type.toUpperCase();
    if (!validMeasureTypes.includes(normalizedMeasureType)) {
      return res.status(400).json({
        error_code: 'INVALID_TYPE',
        error_description: 'Tipo de medição não permitido. Valores válidos são WATER ou GAS.',
      });
    }
  }

  // Filtrar medições por customer_code
  let measures = database.filter(measure => measure.customer_code === customer_code);

  // Filtrar ainda mais por measure_type se fornecido
  if (measure_type && typeof measure_type === 'string') {
    const normalizedMeasureType = measure_type.toUpperCase();
    measures = measures.filter(measure => measure.measure_type.toUpperCase() === normalizedMeasureType);
  }

  // Verificar se não há medições e responder com erro 404
  if (measures.length === 0) {
    return res.status(404).json({
      error_code: 'MEASURES_NOT_FOUND',
      error_description: 'Nenhuma leitura encontrada.',
    });
  }

  // Estruturar a resposta no formato desejado
  const response = {
    customer_code,
    measures: measures.map(measure => ({
      measure_uuid: measure.measure_uuid,
      measure_datetime: measure.measure_datetime,
      measure_type: measure.measure_type,
      has_confirmed: measure.has_confirmed,
      image_url: measure.filePath
    }))
  };

  // Responder com as medições filtradas
  res.status(200).json(response);
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
