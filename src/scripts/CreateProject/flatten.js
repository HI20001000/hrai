const buildRow = ({
  id,
  parentId,
  name,
  type,
  status,
  ownerId,
  updatedAt,
  createdAt,
  depth,
  source,
}) => ({
  id,
  parentId,
  name,
  type,
  status,
  ownerId,
  updatedAt,
  createdAt,
  depth,
  source,
})

export const flattenProjects = (projects) => {
  const rows = []
  projects.forEach((project) => {
    rows.push(
      buildRow({
        id: project.id,
        parentId: null,
        name: project.name,
        type: 'project',
        status: project.status,
        ownerId: project.ownerId,
        updatedAt: project.updatedAt,
        createdAt: project.createdAt,
        depth: 0,
        source: project,
      })
    )
    project.products?.forEach((product) => {
      rows.push(
        buildRow({
          id: product.id,
          parentId: project.id,
          name: product.name,
          type: 'product',
          status: null,
          ownerId: product.ownerId,
          updatedAt: product.updatedAt,
          createdAt: product.createdAt,
          depth: 1,
          source: product,
        })
      )
      product.tasks?.forEach((task) => {
        rows.push(
          buildRow({
            id: task.id,
            parentId: product.id,
            name: task.name,
            type: 'task',
            status: null,
            ownerId: task.ownerId,
            updatedAt: task.updatedAt,
            createdAt: task.createdAt,
            depth: 2,
            source: task,
          })
        )
      })
    })
  })
  return rows
}
