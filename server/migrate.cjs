'use strict';
const {config}=require('./config.cjs');
const {openDatabase,migrate}=require('./database.cjs');
const cfg=config(),db=openDatabase(cfg.databasePath);
try{migrate(db);console.log('Database schema v1 ready')}finally{db.close()}
