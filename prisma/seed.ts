import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'generated/prisma/client'

type CatalogSpec = {
  name: string
  value: string
}

type CatalogCategory = {
  id: string
  name: string
  slug: string
  description: string
  image: string | null
}

type CatalogSubcategory = {
  id: string
  name: string
  slug: string
  categoryId: string
}

type CatalogProduct = {
  id: string
  sku: string
  title: string
  slug: string
  gost: string | null
  price: number | null
  stock: number
  condition: string
  images: string[]
  description: string | null
  analogues: string[]
  categoryId: string
  subcategoryId: string | null
  specs: CatalogSpec[]
}

type Catalog = {
  categories: CatalogCategory[]
  subcategories: CatalogSubcategory[]
  products: CatalogProduct[]
}

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not defined')
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
})

const prisma = new PrismaClient({
  adapter,
})

const catalogPath = path.resolve(
  process.cwd(),
  'data',
  'catalog.json',
)

function readCatalog(): Catalog {
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog file not found: ${catalogPath}`)
  }

  return JSON.parse(
    fs.readFileSync(catalogPath, 'utf8'),
  ) as Catalog
}

async function main() {
  const catalog = readCatalog()
  const descriptions = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'prisma/category-descriptions.json'), 'utf8')) as Record<string, string>

  console.log('Starting catalog import...')
  console.log(`Categories: ${catalog.categories.length}`)
  console.log(`Subcategories: ${catalog.subcategories.length}`)
  console.log(`Products: ${catalog.products.length}`)

  const categoryIds = new Set(
    catalog.categories.map((category) => category.id),
  )

  const subcategoryIds = new Set(
    catalog.subcategories.map((subcategory) => subcategory.id),
  )

  for (const subcategory of catalog.subcategories) {
    if (!categoryIds.has(subcategory.categoryId)) {
      throw new Error(
        `Subcategory "${subcategory.name}" references missing category "${subcategory.categoryId}"`,
      )
    }
  }

  for (const product of catalog.products) {
    if (!categoryIds.has(product.categoryId)) {
      throw new Error(
        `Product "${product.sku}" references missing category "${product.categoryId}"`,
      )
    }

    if (
      product.subcategoryId &&
      !subcategoryIds.has(product.subcategoryId)
    ) {
      throw new Error(
        `Product "${product.sku}" references missing subcategory "${product.subcategoryId}"`,
      )
    }
  }

  await prisma.$transaction(async (tx) => {
    console.log('\nImporting categories...')

    for (const category of catalog.categories) {
      await tx.category.upsert({
        where: {
          id: category.id,
        },
        update: {
          name: category.name,
          slug: category.slug,
          description: descriptions[category.slug] ?? category.description,
          image: category.image ?? '',
        },
        create: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: descriptions[category.slug] ?? category.description,
          image: category.image ?? '',
        },
      })
    }

    console.log('Categories imported.')

    console.log('\nImporting subcategories...')

    for (const subcategory of catalog.subcategories) {
      await tx.subcategory.upsert({
        where: {
          id: subcategory.id,
        },
        update: {
          name: subcategory.name,
          slug: subcategory.slug,
          categoryId: subcategory.categoryId,
        },
        create: {
          id: subcategory.id,
          name: subcategory.name,
          slug: subcategory.slug,
          categoryId: subcategory.categoryId,
        },
      })
    }

    console.log('Subcategories imported.')

    console.log('\nImporting products...')

    for (const product of catalog.products) {
      await tx.product.upsert({
        where: {
          sku: product.sku,
        },
        update: {
          title: product.title,
          slug: product.slug,
          gost: product.gost,
          price: product.price,
          stock: product.stock,
          condition: product.condition as never,
          images: product.images,
          description: product.description,
          analogues: product.analogues,
          categoryId: product.categoryId,
          subcategoryId: product.subcategoryId,

          specs: {
            deleteMany: {},
            create: product.specs.map((spec) => ({
              label: spec.name,
              value: spec.value,
              unit: null,
            })),
          },
        },
        create: {
          id: product.id,
          sku: product.sku,
          title: product.title,
          slug: product.slug,
          gost: product.gost,
          price: product.price,
          stock: product.stock,
          condition: product.condition as never,
          images: product.images,
          description: product.description,
          analogues: product.analogues,
          categoryId: product.categoryId,
          subcategoryId: product.subcategoryId,

          specs: {
            create: product.specs.map((spec) => ({
              label: spec.name,
              value: spec.value,
              unit: null,
            })),
          },
        },
      })
    }

    console.log('Products imported.')
  })

  console.log('\nCatalog import completed successfully.')
}

main()
  .catch((error) => {
    console.error('\nCatalog import failed:')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })