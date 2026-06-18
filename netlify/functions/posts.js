const posts = require('../../data/posts.json');

exports.handler = async () => {
  const approved = posts
    .filter(p => p.status === 'approved')
    .sort((a, b) => new Date(b.date_posted) - new Date(a.date_posted));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
    body: JSON.stringify(approved),
  };
};
