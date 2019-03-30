const models = require('../models');
const Board = models.Board;
const Column = models.Column;
const User = models.User;

const mergeBoards = function (gloBoard, kragglBoard) {
  return {...gloBoard, ...kragglBoard.dataValues };
};

const mergeListOfBoards = function (gloBoards, kragglBoards) {
  return gloBoards.map(gloBoard => {
    const kragglBoard = kragglBoards.find(kragglBoard => kragglBoard.id === gloBoard.id);
    return kragglBoard ? mergeBoards(gloBoard, kragglBoard) : gloBoard;
  });
};

const boards = function (req, res, next) {
  const user = req.user;
  const gloBoardApi = user.gloBoardApi;
  Promise.all([
    gloBoardApi.getBoards({ fields: ['name', 'columns', 'created_by', 'members'] }),
    user.getBoards({})
  ]).then(([{ body: gloBoards }, kragglBoards]) => {
    const boards = mergeListOfBoards(gloBoards, kragglBoards);
    res.render('pages/boards', { user, boards });
  });
};

const board = function (req, res, next) {
  const user = req.user;
  let board, cards, workspaces;
  const boardId = req.params.boardId;

  Promise.all([
    user.gloBoardApi.getBoard(boardId, { fields: ['name', 'columns', 'members'] }),
    Board.findByPk(boardId, { include: { model: Column } }),
    user.gloBoardApi.getCardsOfBoard(boardId, { fields: ['name', 'assignees', 'description', 'labels', 'column_id'] })])
    .then(([{ body: gloBoard }, kragglBoard, { body: gloCards }]) => {
      const trackedColumns = kragglBoard.getTrackedColumns();
      cards = gloCards;
      board = kragglBoard ? mergeBoards(gloBoard, kragglBoard) : gloBoard;
      board.trackedColumns = trackedColumns;
      return user.getWorkspaces();
    })
    .then(workspaces => Promise.all(workspaces.map(workspace => user.getWorkspaceProjects(workspace))))
    .then(workspacesWithProjects => {
      workspaces = workspacesWithProjects;
      if (!board.trackingEnabled) return;
      return user.getDetailedReportForProject(board.togglProjectId);
    })
    .then(report => {
      cards.forEach(card => {
        let timeEntriesForCard = report.data.filter(timeEntry => timeEntry.description === card.name);

        let columnTimes = {};
        let totalTime = 0;
        for (const timeEntry of timeEntriesForCard) {
          for (const tag of timeEntry.tags) {
            if (!columnTimes[tag]) columnTimes[tag] = 0;
            columnTimes[tag] += timeEntry.dur;
          }
          totalTime += timeEntry.dur;
        }
        // let totalTime = timeEntriesForCard.reduce((totalTime, timeEntry) => totalTime + timeEntry.dur, 0);
        for (let key of Object.keys(columnTimes)) {
          columnTimes[key] = msToTime(columnTimes[key]);
        }

        card.totalTime = msToTime(totalTime);
        card.columnTimes = columnTimes;
      });
      res.render('pages/board.ejs', { cards, board, workspaces })
    })
    .catch(error => {
      next(error);
    })
};

const saveBoard = function (req, res, next) {
  const user = req.user;
  const boardId = req.params.boardId;
  const { trackingEnabled, togglProjectId, trackedColumns, chatbotEnabled } = req.body;

  Board.findByPk(boardId, { include: { model: Column } })
    .then(board => {
      if (board) {
        return board.updateBoard({
          togglProjectId,
          trackingEnabled: !!trackingEnabled,
          chatbotEnabled: !!chatbotEnabled,
          trackedColumnIds: trackedColumns
        })
      } else {
        return Board.create({
          id: boardId,
          trackingEnabled: !!trackingEnabled,
          togglProjectId,
          chatbotEnabled: !!chatbotEnabled,
          userId: user.id
        }).then(board => {
          $columns = trackedColumns.map(columnId => {
            return Column.create({ id: columnId, boardId: board.id });
          });
          return Promise.all($columns).then(columns => board.update());
        })
      }
    })
    .then(newBoard => {
      res.redirect('/boards/' + newBoard.id);
    })
    .catch(error => {
      console.log(error);
      // TODO: Handle error
    });
};

const msToTime = function(duration){
   let seconds = parseInt((duration/1000)%60)
   , minutes = parseInt((duration/(1000*60))%60)
   , hours = parseInt((duration/(1000*60*60))%24);

   hours = (hours < 10) ? "0" + hours : hours;
   minutes = (minutes < 10) ? "0" + minutes : minutes;
   seconds = (seconds < 10) ? "0" + seconds : seconds;

   return hours + ":" + minutes + ":" + seconds;
};

module.exports = {
  boards,
  board,
  saveBoard
};
